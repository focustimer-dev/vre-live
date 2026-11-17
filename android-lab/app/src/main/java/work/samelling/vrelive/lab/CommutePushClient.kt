package work.samelling.vrelive.lab

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Opt-in, native-only bridge to the isolated preview monitor.
 *
 * All network work is triggered by explicit pairing, a confirmed train,
 * token rotation, or cancellation. Never fetches a VRE feed or polls when idle.
 * No Cloudflare admin token, pairing code or raw per-device access token is
 * written to source, assets, logs or cleartext SharedPreferences.
 */
internal object CommutePushClient {
    private const val API = "https://vre-live-commute-monitor-preview.samelling.workers.dev"
    private const val PREF = "commute_push_v1"
    private const val CREDENTIAL = "credential"
    private const val WATCHES = "watches"
    private const val PENDING_CANCEL = "pending_cancel"
    private const val KEY_ALIAS = "vre_commute_push_device_v1"
    private const val CHANNEL = "commute_leave_now_v1"
    private val io = Executors.newSingleThreadExecutor()
    private val zone = ZoneId.of("America/New_York")
    private val dateFormat = DateTimeFormatter.BASIC_ISO_DATE
    private fun prefs(context: Context) = context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
            generateKey()
        }
    }
    private fun encrypt(text: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return Base64.encodeToString(cipher.iv + cipher.doFinal(text.toByteArray(Charsets.UTF_8)),
            Base64.NO_WRAP)
    }
    private fun decrypt(data: String): String {
        val bytes = Base64.decode(data, Base64.NO_WRAP)
        require(bytes.size > 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }
    private fun identity(context: Context): JSONObject? = runCatching {
        val value = prefs(context).getString(CREDENTIAL, null) ?: return@runCatching null
        JSONObject(decrypt(value))
    }.getOrNull()
    fun paired(context: Context): Boolean {
        val value = identity(context) ?: return false
        return value.optString("deviceId").matches(Regex("device_[a-f0-9]{32}")) &&
            value.optString("accessToken").matches(Regex("[A-Za-z0-9_-]{43}"))
    }
    private fun bearer(identity: JSONObject): String = "Bearer " +
        identity.getString("deviceId") + "." + identity.getString("accessToken")
    private fun localWatches(context: Context): JSONObject = runCatching {
        JSONObject(prefs(context).getString(WATCHES, "{}").orEmpty())
    }.getOrDefault(JSONObject())
    private fun saveWatches(context: Context, watches: JSONObject) {
        prefs(context).edit().putString(WATCHES, watches.toString()).commit()
    }
    private fun request(path: String, body: JSONObject, identity: JSONObject? = null,
                        method: String = "POST"): JSONObject {
        val connection = URL(API + path).openConnection() as HttpURLConnection
        connection.connectTimeout = 10000
        connection.readTimeout = 10000
        connection.requestMethod = method
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        if (identity != null)
            connection.setRequestProperty("Authorization", bearer(identity))
        try {
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val result = stream?.bufferedReader()?.use { it.readText().take(16384) } ?: "{}"
            if (status !in 200..299) throw IllegalStateException("Monitor returned HTTP $status")
            return JSONObject(result)
        } finally { connection.disconnect() }
    }
    private fun allowed(context: Context): Boolean =
        CommuteCheckIns.leaveNowEnabled(context) &&
        (Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED) &&
        context.getSystemService(NotificationManager::class.java)?.areNotificationsEnabled() == true

    /** May be invoked only by the native button after global consent and OS permission. */
    fun pair(context: Context, code: String, done: (Boolean, String) -> Unit) {
        if (!CommuteCheckIns.enabled(context)) {
            done(false, "Enable Notifications first"); return
        }
        if (!code.matches(Regex("[A-Za-z0-9_-]{24,96}"))) {
            done(false, "Enter a valid one-time pairing code"); return
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED) {
            done(false, "Allow Android notifications before pairing"); return
        }
        if (paired(context)) { done(true, "This phone is already paired"); return }
        // Firebase auto-init remains off until the user deliberately pairs.
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful || task.result.isNullOrBlank()) {
                done(false, "Firebase registration unavailable"); return@addOnCompleteListener
            }
            val token = task.result
            io.execute {
                val result = runCatching {
                    val response = request("/v1/devices/pair",
                        JSONObject().put("pairingCode", code).put("fcmToken", token))
                    val deviceId = response.getString("deviceId")
                    val access = response.getString("accessToken")
                    require(deviceId.matches(Regex("device_[a-f0-9]{32}")) &&
                        access.matches(Regex("[A-Za-z0-9_-]{43}")))
                    prefs(context).edit().putString(CREDENTIAL,
                        encrypt(JSONObject().put("deviceId", deviceId)
                            .put("accessToken", access).toString())).commit()
                    true
                }.getOrElse { false }
                if (!result) {
                    FirebaseMessaging.getInstance().isAutoInitEnabled = false
                    FirebaseMessaging.getInstance().deleteToken()
                }
                android.os.Handler(context.mainLooper).post {
                    done(result, if (result) "Device paired successfully"
                        else "Pairing failed. Check the code and preview service.")
                }
            }
        }
    }
    private fun currentDate(): String = LocalDate.now(zone).format(dateFormat)
    private fun watchId(id: String, train: String, date: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(
            (id + ":" + train + ":" + date).toByteArray(Charsets.UTF_8))
        return "watch_" + digest.take(16).joinToString("") { "%02x".format(it) }
    }
    /** Called ONLY after Android accepts an explicitly selected train. */
    fun watchSelected(context: Context, profileId: String) {
        if (!paired(context) || !allowed(context)) return
        val plan = CommuteCheckIns.confirmedPlan(context, profileId) ?: return
        val train = plan.optString("train")
        val date = plan.optString("serviceDate")
        val id = watchId(profileId, train, date)
        val identity = identity(context) ?: return
        val body = JSONObject()
            .put("watchId", id).put("trainNumber", train)
            .put("from", plan.optString("from")).put("to", plan.optString("to"))
            .put("travelMinutes", plan.optInt("travelMinutes"))
            .put("platformMinutes", plan.optInt("platformMinutes"))
            .put("bufferMinutes", plan.optInt("bufferMinutes"))
        io.execute {
            val ok = runCatching {
                request("/v1/watches", body, identity).optBoolean("ok")
            }.getOrDefault(false)
            if (ok && allowed(context) &&
                CommuteCheckIns.confirmedPlan(context, profileId)?.optString("train") == train &&
                currentDate() == date) {
                val watches = localWatches(context)
                watches.put(id, JSONObject().put("profileId", profileId).put("train", train)
                    .put("date", date).put("station", plan.optString("from")))
                saveWatches(context, watches)
            } else if (ok) {
                // A skip/opt-out may have happened during the HTTP round-trip.
                runCatching {
                    request("/v1/watches", JSONObject().put("watchId", id), identity,"DELETE")
                }
            }
        }
    }
    private fun queueCancel(context: Context, ids: List<String>, all: Boolean = false) {
        if (ids.isEmpty() && !all) return
        val identity = identity(context) ?: return
        val toCancel = JSONObject().put("all", all)
            .put("ids", org.json.JSONArray(ids))
        prefs(context).edit().putString(PENDING_CANCEL, toCancel.toString()).commit()
        io.execute { flushCancels(context, identity) }
    }
    private fun flushCancels(context: Context, credential: JSONObject) {
        val pending = runCatching {
            JSONObject(prefs(context).getString(PENDING_CANCEL, "{}").orEmpty())
        }.getOrDefault(JSONObject())
        if (pending.optBoolean("all")) {
            if (runCatching {
                    request("/v1/watches/cancel-all", JSONObject(), credential).optBoolean("ok")
                }.getOrDefault(false)) prefs(context).edit().remove(PENDING_CANCEL).commit()
        } else {
            val list = pending.optJSONArray("ids") ?: return
            var ok = true
            for (i in 0 until list.length()) {
                ok = runCatching {
                    request("/v1/watches", JSONObject().put("watchId", list.getString(i)),
                        credential,"DELETE").optBoolean("ok")
                }.getOrDefault(false) && ok
            }
            if (ok) prefs(context).edit().remove(PENDING_CANCEL).commit()
        }
    }
    fun cancelTrip(context: Context, profileId: String) {
        val watches = localWatches(context)
        val ids = mutableListOf<String>()
        val keys = watches.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            if (watches.optJSONObject(k)?.optString("profileId") == profileId) ids.add(k)
        }
        for (id in ids) watches.remove(id)
        saveWatches(context, watches)
        queueCancel(context, ids)
    }
    fun cancelAll(context: Context) {
        saveWatches(context, JSONObject())
        queueCancel(context, emptyList(),true)
    }
    fun onSettingsUpdated(context: Context) {
        if (!allowed(context)) {
            cancelAll(context)
            return
        }
        if (!paired(context)) return
        val planned = CommuteCheckIns.stateObject(context).optJSONObject("planned") ?: return
        val ids = planned.keys()
        while (ids.hasNext()) watchSelected(context, ids.next())
    }
    fun onTokenRotated(context: Context, token: String) {
        val credential = identity(context) ?: return
        if (token.isBlank()) return
        io.execute {
            runCatching {
                request("/v1/devices/token",JSONObject().put("fcmToken",token),credential)
            }
        }
    }
    fun onAppOpened(context: Context) {
        identity(context)?.let { id -> io.execute { flushCancels(context,id) } }
    }
    fun displayIfAllowed(context: Context, data: Map<String, String>) {
        if (!allowed(context)) return
        if (data["kind"] != "leave_now") return
        if (data["serviceDate"] != currentDate()) return
        val id = data["watchId"] ?: return
        val w = localWatches(context).optJSONObject(id) ?: return
        if (w.optString("train") != data["trainNumber"] ||
            w.optString("date") != data["serviceDate"] ||
            w.optString("station") != data["stationCode"]) return
        val current = CommuteCheckIns.confirmedPlan(context, w.optString("profileId"))
            ?: return
        if (current.optString("train") != data["trainNumber"]) return
        val manager=context.getSystemService(NotificationManager::class.java) ?: return
        val sound=CommuteCheckIns.soundEnabled(context)
        val vibration=CommuteCheckIns.vibrationEnabled(context)
        val channel=CHANNEL+"_"+(if(sound) "sound" else "silent")+
            "_"+(if(vibration) "vibrate" else "still")
        manager.createNotificationChannel(NotificationChannel(channel,
            "Commute leave-now alerts",NotificationManager.IMPORTANCE_HIGH).apply {
            if (!sound) setSound(null,null)
            enableVibration(vibration)
        })
        val intent=PendingIntent.getActivity(context,0,Intent(context,MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.notify(id.hashCode(),Notification.Builder(context,channel)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("Leave now for train "+w.optString("train"))
            .setContentText("Head to the station for your confirmed commute")
            .setContentIntent(intent).setAutoCancel(true).build())
        // A delivered notification must never be redisplayed from a replay.
        w.put("shown",true)
        val watches=localWatches(context)
        watches.put(id,w)
        saveWatches(context,watches)
    }
}
