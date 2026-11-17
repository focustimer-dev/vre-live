package work.samelling.vrelive.lab

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.annotation.RequiresApi
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * Android-local daily confirmation prompts. Never opens a GTFS feed or starts RideMonitor.
 * A confirmation is only a local intent until departure monitoring ships separately.
 */
internal object CommuteCheckIns {
    private const val STORE = "commute_checkins"
    private const val PROFILES = "profiles"
    private const val ALERTS = "alerts"
    private const val DAY = "day"
    private const val NEXT_AT = "next_at"
    private const val NEXT_ID = "next_id"
    private const val CHANNEL = "commute_checkins"
    private const val ALARM_CODE = 20451
    private const val NOTIFICATION_ID = 410
    const val SHOW = "work.samelling.vrelive.lab.COMMUTE_SHOW"
    const val LATER = "work.samelling.vrelive.lab.COMMUTE_LATER"
    const val SKIP_DAY = "work.samelling.vrelive.lab.COMMUTE_SKIP_DAY"
    const val CONFIRM = "work.samelling.vrelive.lab.COMMUTE_CONFIRM"
    const val OPEN_PLAN = "work.samelling.vrelive.lab.COMMUTE_OPEN_PLAN"
    const val RECHECK = "work.samelling.vrelive.lab.COMMUTE_RECHECK"
    private val zone = ZoneId.of("America/New_York")
    private val stamp = DateTimeFormatter.BASIC_ISO_DATE
    private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
    private fun nowDate() = LocalDate.now(zone)
    private fun dayKey() = nowDate().format(stamp)
    private fun storedProfiles(context: Context) = runCatching {
        JSONObject(prefs(context).getString(PROFILES, "{}").orEmpty()).optJSONArray("profiles")
    }.getOrNull() ?: JSONArray()
    private fun profile(context: Context, id: String): JSONObject? {
        if (!Regex("[A-Za-z0-9_-]{1,72}").matches(id)) return null
        val profiles = storedProfiles(context)
        for (i in 0 until profiles.length()) {
            val p = profiles.optJSONObject(i) ?: continue
            if (p.optString("id") == id) return p
        }
        return null
    }
    private fun daily(context: Context): JSONObject {
        val stored = runCatching {
            JSONObject(prefs(context).getString(DAY, "{}").orEmpty())
        }.getOrDefault(JSONObject())
        if (stored.optString("date") == dayKey()) return stored
        return JSONObject().put("date", dayKey()).put("skippedDay", false)
            .put("skippedTrips", JSONObject()).put("confirmed", JSONObject())
            .put("planned", JSONObject()).put("reminded", JSONObject())
            .put("prompted", JSONObject())
    }
    private fun persistDaily(context: Context, daily: JSONObject) {
        prefs(context).edit().putString(DAY, daily.toString()).apply()
    }
    /** Legacy per-profile opt-ins survive until the user explicitly switches to global scheduling. */
    private fun alerts(context: Context): JSONObject {
        val saved = prefs(context).getString(ALERTS, null)
        if (saved != null) {
            val parsed = runCatching { JSONObject(saved) }.getOrNull()
            if (parsed?.optInt("version") == 1) return parsed
            return JSONObject().put("version", -1).put("enabled", false)
        }
        val profiles = storedProfiles(context)
        val ids = JSONArray()
        for (i in 0 until profiles.length()) {
            val p = profiles.optJSONObject(i) ?: continue
            if (p.optBoolean("checkInEnabled")) ids.put(p.optString("id"))
        }
        return JSONObject().put("version", 1)
            .put("enabled", ids.length() > 0).put("checkIns", ids.length() > 0)
            .put("arrival", false).put("leaveNow", false)
            .put("leadMinutes", 15).put("sound", false).put("vibration", false)
            .put("legacyTimes", ids.length() > 0).put("scopeIds", ids)
    }

    fun enabled(context: Context): Boolean = alerts(context).optBoolean("enabled")
    fun arrivalEnabled(context: Context): Boolean =
        enabled(context) && alerts(context).optBoolean("arrival")
    private fun checkInsEnabled(context: Context): Boolean =
        enabled(context) && alerts(context).optBoolean("checkIns")

    fun state(context: Context): String = daily(context)
        .put("type", "state")
        .put("notificationsAllowed", notificationsAllowed(context))
        .put("globalEnabled", enabled(context)).toString()

    private fun notificationsAllowed(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        return manager.areNotificationsEnabled()
    }

    /** Browser model is stored only for native prompts; legacy and unknown versions are ignored. */
    fun sync(context: Context, record: JSONObject): Boolean {
        if (record.optInt("version") != 1) return false
        val incoming = record.optJSONArray("profiles") ?: return false
        if (incoming.length() > 32 || record.toString().length > 32768) return false
        for (i in 0 until incoming.length()) {
            val p = incoming.optJSONObject(i) ?: return false
            if (!Regex("[A-Za-z0-9_-]{1,72}").matches(p.optString("id"))) return false
            val clock = p.optString("checkIn")
            if (!Regex("([01][0-9]|2[0-3]):[0-5][0-9]").matches(clock)) return false
            if (p.optJSONArray("days") == null || p.optJSONArray("preferredTrains") == null) return false
        }
        val incomingAlerts = record.optJSONObject("alerts")
        if (incomingAlerts != null && incomingAlerts.optInt("version") != 1) return false
        // Global policy is optional only for older clients; preserve existing policy
        // rather than resetting user consent on a stale WebView sync.
        val edit = prefs(context).edit().putString(PROFILES, record.toString())
        if (incomingAlerts != null) {
            val lead = incomingAlerts.optInt("leadMinutes", 15)
            if (lead !in 5..90) return false
            val scope = incomingAlerts.optJSONArray("scopeIds")
            if (scope != null) for (i in 0 until scope.length()) {
                if (!Regex("[A-Za-z0-9_-]{1,72}").matches(scope.optString(i))) return false
            }
            edit.putString(ALERTS, incomingAlerts.toString())
        }
        edit.apply()
        if (!checkInsEnabled(context)) {
            cancelReminders(context)
            val manager = context.getSystemService(NotificationManager::class.java)
            val profiles = storedProfiles(context)
            for (i in 0 until profiles.length()) {
                manager?.cancel(notificationId(profiles.optJSONObject(i)?.optString("id").orEmpty()))
            }
        }
        reschedule(context)
        return true
    }

    private fun notIn(array: JSONArray?, value: String): Boolean {
        if (array == null) return true
        for (i in 0 until array.length()) if (array.optString(i) == value) return false
        return true
    }

    /** Only ask about trains that actually operate that date and serve both stations. */
    private fun hasService(context: Context, p: JSONObject, date: LocalDate, selectedTrain: String? = null): Boolean {
        if (date.dayOfWeek.value >= 6) return false
        val data = runCatching { Timetable(context).data }.getOrNull() ?: return false
        val key = date.format(stamp)
        if (!notIn(data.optJSONArray("noService"), key)) return false
        val days = p.optJSONArray("days") ?: return false
        var weekday = false
        val jsDay = date.dayOfWeek.value % 7
        for (i in 0 until days.length()) if (days.optInt(i, -1) == jsDay) weekday = true
        if (!weekday) return false
        val trains = p.optJSONArray("preferredTrains") ?: return false
        if (trains.length() == 0) return false
        val reduced = !notIn(data.optJSONArray("reducedService"), key)
        val special = data.optJSONArray("sTrains")
        val trips = data.optJSONArray("trips") ?: return false
        for (i in 0 until trips.length()) {
            val trip = trips.optJSONObject(i) ?: continue
            val num = trip.optString("num")
            if (notIn(trains, num) || (selectedTrain != null && selectedTrain != num) ||
                (reduced && notIn(special, num))) continue
            val stops = trip.optJSONArray("stops") ?: continue
            var board = -1
            var destination = -1
            for (s in 0 until stops.length()) {
                val code = stops.optJSONArray(s)?.optString(0).orEmpty()
                if (code == p.optString("from")) board = s
                if (code == p.optString("to")) destination = s
            }
            if (board >= 0 && destination > board) return true
        }
        return false
    }

    /** Derive an opt-in prompt from the earliest preferred departure, without any feed requests. */
    private fun checkInAt(context: Context, p: JSONObject, date: LocalDate, cfg: JSONObject): Long? {
        if (!hasService(context, p, date)) return null
        val id = p.optString("id")
        val legacy = cfg.optBoolean("legacyTimes")
        if (legacy) {
            val allowed = cfg.optJSONArray("scopeIds") ?: return null
            if (notIn(allowed, id) || !p.optBoolean("checkInEnabled")) return null
            val time = runCatching { LocalTime.parse(p.optString("checkIn")) }.getOrNull() ?: return null
            return date.atTime(time).atZone(zone).toInstant().toEpochMilli()
        }
        val scope = cfg.optJSONArray("scopeIds")
        if (scope != null && notIn(scope, id)) return null
        val data = runCatching { Timetable(context).data }.getOrNull() ?: return null
        val reduced = !notIn(data.optJSONArray("reducedService"), date.format(stamp))
        val selected = p.optJSONArray("preferredTrains") ?: return null
        val preferred = mutableSetOf<String>()
        for (i in 0 until selected.length()) preferred.add(selected.optString(i))
        val trips = data.optJSONArray("trips") ?: return null
        var earliest: Int? = null
        for (i in 0 until trips.length()) {
            val t = trips.optJSONObject(i) ?: continue
            if (t.optString("num") !in preferred ||
                (reduced && notIn(data.optJSONArray("sTrains"), t.optString("num")))) continue
            val stops = t.optJSONArray("stops") ?: continue
            val from = p.optString("from")
            val to = p.optString("to")
            var board = -1
            var destination = -1
            for (j in 0 until stops.length()) {
                val code = stops.optJSONArray(j)?.optString(0).orEmpty()
                if (code == from) board = j
                if (code == to) destination = j
            }
            if (board < 0 || destination <= board) continue
            val departure = stops.optJSONArray(board)?.optInt(1, -1) ?: -1
            if (departure < 0) continue
            earliest = if (earliest == null) departure else minOf(earliest, departure)
        }
        val minute = earliest ?: return null
        val travel = p.optInt("travelMinutes", 0).coerceIn(0, 180)
        val platform = p.optInt("platformMinutes", 0).coerceIn(0, 60)
        val buffer = p.optInt("bufferMinutes", 0).coerceIn(0, 60)
        if (travel + platform <= 0) return null // Must configure an actual station approach.
        val askLead = cfg.optInt("leadMinutes", 15).coerceIn(5, 90)
        return date.atStartOfDay(zone).plusMinutes(
            (minute - travel - platform - buffer - askLead).toLong()).toInstant().toEpochMilli()
    }

    private fun alarmIntent(context: Context): PendingIntent =
        PendingIntent.getBroadcast(context, ALARM_CODE,
            Intent(context, CommuteCheckReceiver::class.java).setAction(SHOW),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun reminderIntent(context: Context, profileId: String): PendingIntent =
        PendingIntent.getBroadcast(context, profileId.hashCode(),
            Intent(context, CommuteCheckReceiver::class.java).setAction(SHOW + ".REMINDER")
                .setData(Uri.parse("vre://commute/reminder/" + profileId)),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun cancelAlarm(context: Context) {
        context.getSystemService(AlarmManager::class.java)?.cancel(alarmIntent(context))
        prefs(context).edit().remove(NEXT_AT).remove(NEXT_ID).apply()
    }

    private fun cancelReminders(context: Context) {
        val profiles = storedProfiles(context)
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        for (i in 0 until profiles.length()) {
            val id = profiles.optJSONObject(i)?.optString("id").orEmpty()
            if (id.isNotEmpty()) alarms.cancel(reminderIntent(context, id))
        }
    }

    private fun alarm(context: Context, at: Long, pending: PendingIntent) {
        val manager = context.getSystemService(AlarmManager::class.java) ?: return
        // Exact alarms are restricted on modern Android; use them only when already allowed.
        if (Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms()) {
            try {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
                return
            } catch (_: SecurityException) { /* fall back to inexact */ }
        }
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
    }

    fun reschedule(context: Context, after: Long = System.currentTimeMillis()) {
        cancelAlarm(context)
        if (!notificationsAllowed(context) || !checkInsEnabled(context)) return
        val cfg = alerts(context)
        val profiles = storedProfiles(context)
        val now = ZonedDateTime.now(zone)
        val state = daily(context)
        var nextAt = Long.MAX_VALUE
        var nextId = ""
        for (d in 0..14) {
            val date = now.toLocalDate().plusDays(d.toLong())
            if (date.dayOfWeek.value >= 6) continue
            if (d == 0 && state.optBoolean("skippedDay")) continue
            for (i in 0 until profiles.length()) {
                val p = profiles.optJSONObject(i) ?: continue
                val id = p.optString("id")
                if (d == 0 && (state.optJSONObject("skippedTrips")?.optBoolean(id) == true ||
                        state.optJSONObject("confirmed")?.optBoolean(id) == true ||
                        state.optJSONObject("prompted")?.optBoolean(id) == true)) continue
                val at = checkInAt(context, p, date, cfg) ?: continue
                if (at <= after || at >= nextAt) continue
                nextAt = at
                nextId = id
            }
        }
        if (nextId.isEmpty()) return
        prefs(context).edit().putLong(NEXT_AT, nextAt).putString(NEXT_ID, nextId).apply()
        alarm(context, nextAt, alarmIntent(context))
    }

    private fun notificationId(id: String) = NOTIFICATION_ID + (id.hashCode() and 0x7fffffff) % 100000
    private fun action(context: Context, id: String, action: String, activity: Boolean): PendingIntent {
        val requestCode = (id + action).hashCode()
        val intent = if (activity) Intent(context, MainActivity::class.java)
            else Intent(context, CommuteCheckReceiver::class.java)
        intent.action = action
        intent.data = Uri.parse("vre://commute/" + action.substringAfterLast(".") + "/" + id)
        intent.putExtra("profileId", id)
        if (activity) {
            intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            return PendingIntent.getActivity(context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        return PendingIntent.getBroadcast(context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    private fun show(context: Context, id: String) {
        if (!notificationsAllowed(context)) return
        val p = profile(context, id) ?: return
        if (daily(context).optBoolean("skippedDay")) return
        if (!hasService(context, p, nowDate())) return
        val state = daily(context)
        if (state.optJSONObject("confirmed")?.optBoolean(id) == true ||
            state.optJSONObject("skippedTrips")?.optBoolean(id) == true) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(NotificationChannel(CHANNEL,
            "Commute check-ins", NotificationManager.IMPORTANCE_DEFAULT).apply {
            enableVibration(false)
        })
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("Taking the train today?")
            .setContentText(p.optString("name", "Your commute") + " · choose a preferred train")
            .setAutoCancel(true)
            .setContentIntent(action(context, id, OPEN_PLAN, true))
            .addAction(Notification.Action.Builder(null, "Yes",
                action(context, id, CONFIRM, true)).build())
            .addAction(Notification.Action.Builder(null, "Not sure",
                action(context, id, LATER, false)).build())
            .addAction(Notification.Action.Builder(null, "Not riding today",
                action(context, id, SKIP_DAY, false)).build())
            .build()
        manager.notify(notificationId(id), notification)
    }

    fun onScheduled(context: Context) {
        val pref = prefs(context)
        val at = pref.getLong(NEXT_AT, 0)
        val id = pref.getString(NEXT_ID, "").orEmpty()
        val now = System.currentTimeMillis()
        if (id.isNotEmpty() && at > 0 && now >= at - 120000 && now - at <= 30 * 60000) {
            // Deliver all enabled commutes scheduled for the same minute, not just
            // whichever profile won the single-alarm queue tie-break.
            val profiles = storedProfiles(context)
            val today = nowDate()
            for (i in 0 until profiles.length()) {
                val p = profiles.optJSONObject(i) ?: continue
                if (!p.optBoolean("checkInEnabled") || !hasService(context, p, today)) continue
                val time = runCatching { LocalTime.parse(p.optString("checkIn")) }.getOrNull() ?: continue
                val trigger = today.atTime(time).atZone(zone).toInstant().toEpochMilli()
                if (trigger == at) show(context, p.optString("id"))
            }
        }
        reschedule(context, maxOf(now, at + 1000))
    }

    fun onReminder(context: Context, id: String) {
        show(context, id)
    }

    fun later(context: Context, id: String) {
        val p = profile(context, id) ?: return
        if (!hasService(context, p, nowDate())) return
        val state = daily(context)
        val reminded = state.optJSONObject("reminded") ?: JSONObject()
        val times = reminded.optInt(id, 0)
        if (times >= 1) return
        reminded.put(id, times + 1)
        state.put("reminded", reminded)
        persistDaily(context, state)
        context.getSystemService(NotificationManager::class.java)?.cancel(notificationId(id))
        alarm(context, System.currentTimeMillis() + 10 * 60000, reminderIntent(context, id))
    }

    fun confirm(context: Context, id: String): Boolean {
        val p = profile(context, id) ?: return false
        if (!hasService(context, p, nowDate())) return false
        val state = daily(context)
        state.put("skippedDay", false)
        val skipped = state.optJSONObject("skippedTrips") ?: JSONObject()
        skipped.remove(id)
        state.put("skippedTrips", skipped)
        val confirmed = state.optJSONObject("confirmed") ?: JSONObject()
        confirmed.put(id, true)
        state.put("confirmed", confirmed)
        persistDaily(context, state)
        context.getSystemService(NotificationManager::class.java)?.cancel(notificationId(id))
        context.getSystemService(AlarmManager::class.java)?.cancel(reminderIntent(context, id))
        reschedule(context)
        return true
    }

    fun plan(context: Context, id: String, train: String): Boolean {
        val p = profile(context, id) ?: return false
        if (!Regex("[0-9A-Za-z_-]{1,32}").matches(train)) return false
        if (notIn(p.optJSONArray("preferredTrains"), train) || !hasService(context, p, nowDate(), train)) return false
        if (!confirm(context, id)) return false
        val state = daily(context)
        val planned = state.optJSONObject("planned") ?: JSONObject()
        planned.put(id, train)
        state.put("planned", planned)
        persistDaily(context, state)
        return true
    }

    fun skipTrip(context: Context, id: String) {
        if (profile(context, id) == null) return
        val state = daily(context)
        state.optJSONObject("planned")?.remove(id)
        state.optJSONObject("confirmed")?.remove(id)
        val skipped = state.optJSONObject("skippedTrips") ?: JSONObject()
        skipped.put(id, true)
        state.put("skippedTrips", skipped)
        persistDaily(context, state)
        context.getSystemService(NotificationManager::class.java)?.cancel(notificationId(id))
        context.getSystemService(AlarmManager::class.java)?.cancel(reminderIntent(context, id))
        reschedule(context)
    }

    fun skipToday(context: Context) {
        val state = daily(context)
        state.put("skippedDay", true)
        state.put("planned", JSONObject()).put("confirmed", JSONObject())
        val manager = context.getSystemService(NotificationManager::class.java)
        val profiles = storedProfiles(context)
        val skipped = JSONObject()
        // Remember the whole-day decision for each profile so reactivating one
        // trip never silently re-enables the afternoon or another saved commute.
        for (i in 0 until profiles.length()) {
            val id = profiles.optJSONObject(i)?.optString("id").orEmpty()
            if (id.isNotEmpty()) { skipped.put(id, true); manager?.cancel(notificationId(id)) }
        }
        state.put("skippedTrips", skipped)
        persistDaily(context, state)
        cancelReminders(context)
        reschedule(context)
    }

    fun reactivate(context: Context, id: String) {
        if (profile(context, id) == null) return
        val state = daily(context)
        state.put("skippedDay", false)
        state.optJSONObject("skippedTrips")?.remove(id)
        persistDaily(context, state)
        reschedule(context)
    }
}

/** Boot, clock changes and notification action buttons never initiate network requests. */
class CommuteCheckReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            CommuteCheckIns.SHOW -> CommuteCheckIns.onScheduled(context)
            CommuteCheckIns.SHOW + ".REMINDER" ->
                CommuteCheckIns.onReminder(context, intent.data?.lastPathSegment.orEmpty())
            CommuteCheckIns.LATER ->
                CommuteCheckIns.later(context, intent.getStringExtra("profileId").orEmpty())
            CommuteCheckIns.SKIP_DAY -> CommuteCheckIns.skipToday(context)
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED,
            CommuteCheckIns.RECHECK -> CommuteCheckIns.reschedule(context)
        }
    }
}
