package work.samelling.vrelive.lab

import android.app.*
import android.content.Intent
import android.os.*
import com.google.transit.realtime.GtfsRealtime
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** One explicitly selected ride, stopped on delivery, cancellation, or a four-hour limit. */
class RideMonitor : Service() {
    companion object { @Volatile var activeKey: String? = null }
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private var ride = JSONObject()
    private var cookie = ""
    @Volatile private var stopped = false
    private val prefs by lazy { getSharedPreferences("departures_widgets", MODE_PRIVATE) }
    private val timetable by lazy { JSONObject(assets.open("app/widget-schedule.json").bufferedReader().use { it.readText() }) }
    private val manager by lazy { getSystemService(NotificationManager::class.java)!! }
    private fun key(value: JSONObject) = listOf(value.optString("trip"), value.optString("dest"), value.optLong("started")).joinToString(":")
    private val stopIntent by lazy { PendingIntent.getService(this, 31,
        Intent(this, RideMonitor::class.java).setAction("stop"), PendingIntent.FLAG_IMMUTABLE) }
    private val openIntent by lazy { PendingIntent.getActivity(this, 31,
        Intent(this, MainActivity::class.java).setAction("work.samelling.vrelive.lab.OPEN_LOCK_CARD"),
        PendingIntent.FLAG_IMMUTABLE) }

    override fun onBind(intent: Intent?) = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop" || intent?.getStringExtra("ride") == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (cookie.isNotEmpty()) return START_NOT_STICKY
        ride = runCatching { JSONObject(intent.getStringExtra("ride").orEmpty()) }.getOrDefault(JSONObject())
        cookie = intent.getStringExtra("cookie").orEmpty()
        activeKey = key(ride)
        manager.createNotificationChannel(NotificationChannel("ride_monitor", "Active ride monitoring", NotificationManager.IMPORTANCE_LOW))
        startForeground(31, card("Checking your train"))
        executor.scheduleWithFixedDelay({ poll() }, 0, 90, TimeUnit.SECONDS)
        return START_NOT_STICKY
    }

    private fun card(text: String) = Notification.Builder(this, "ride_monitor")
        .setSmallIcon(R.drawable.ic_launcher).setContentTitle("Monitoring train ${ride.optString("num")}")
        .setContentText(text).setOnlyAlertOnce(true).setOngoing(true)
        .setVisibility(Notification.VISIBILITY_PUBLIC).setContentIntent(openIntent)
        .addAction(Notification.Action.Builder(null, "Stop monitoring", stopIntent).build()).build()

    private fun stopMatches(): Boolean {
        val snapshot = runCatching { JSONObject(prefs.getString("snapshot", "{}").orEmpty()) }.getOrDefault(JSONObject())
        val current = snapshot.optJSONObject("ride")
        return current != null && !current.optBoolean("waiting") && key(current) == key(ride)
    }

    private fun poll() {
        if (stopped) return
        val age = System.currentTimeMillis() - ride.optLong("started")
        if (age !in 0L..14400000L || !stopMatches()) { stopSelf(); return }
        val wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "vre:ride-check")
        try {
            wake.acquire(30000)
            if (MainActivity.visible) {
                val snapshot = JSONObject(prefs.getString("snapshot", "{}").orEmpty()).optJSONObject("ride")
                if (snapshot != null) checkArrival(snapshot.optLong("eta"), snapshot.optLong("ts"))
                return
            }
            val connection = URL("https://vre-live-lab-preview.samelling.workers.dev/feed/TripUpdateFeed")
                .openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = 10000
                connection.readTimeout = 10000
                connection.instanceFollowRedirects = false
                connection.setRequestProperty("Cookie", cookie)
                if (connection.responseCode == 401) { stopSelf(); return }
                check(connection.responseCode == 200)
                val bytes = connection.inputStream.use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    var count = input.read(buffer)
                    while (count >= 0) {
                        check(output.size() + count <= 2000000)
                        output.write(buffer, 0, count)
                        count = input.read(buffer)
                    }
                    output.toByteArray()
                }
                val feed = GtfsRealtime.FeedMessage.parseFrom(bytes)
                val date = ZonedDateTime.now(ZoneId.of("America/New_York")).format(DateTimeFormatter.BASIC_ISO_DATE)
                val update = feed.entityList.asSequence().filter { it.hasTripUpdate() }.map { it.tripUpdate }
                    .firstOrNull { it.trip.tripId == ride.optString("sourceTrip", ride.optString("trip")) &&
                        (!it.trip.hasStartDate() || it.trip.startDate == date) } ?: return
                if (update.trip.scheduleRelationship == GtfsRealtime.TripDescriptor.ScheduleRelationship.CANCELED) {
                    stopSelf(); return
                }
                val stop = update.stopTimeUpdateList.firstOrNull { resolveStop(it.stopId) == ride.optString("dest") } ?: return
                val event = if (stop.hasArrival() && stop.arrival.hasTime()) stop.arrival else stop.departure
                val timestamp = if (update.hasTimestamp()) update.timestamp else feed.header.timestamp
                if (event.hasTime()) checkArrival(event.time * 1000, timestamp * 1000)
            } finally { connection.disconnect() }
        } catch (_: Exception) {
            if (!stopped) manager.notify(31, card("Live update unavailable · retrying"))
        } finally { if (wake.isHeld) wake.release() }
    }

    private fun resolveStop(id: String): String {
        val upper = id.uppercase()
        val aliases = timetable.getJSONObject("stopAliases")
        if (aliases.has(upper)) return aliases.getString(upper)
        if (id.equals("dc8e2e569500000066c00b02130a0000", true)) return "SP"
        return if (upper.matches(Regex("0{30}[0-9A-F]{2}"))) upper.takeLast(2) else ""
    }

    private fun checkArrival(eta: Long, timestamp: Long) {
        val now = System.currentTimeMillis()
        if (eta <= 0 || now - timestamp !in -60000L..300000L) {
            manager.notify(31, card("Waiting for a fresh train update"))
            return
        }
        val left = eta - now
        val name = timetable.getJSONObject("stations").optString(ride.optString("dest"), "your stop")
        val time = java.time.Instant.ofEpochMilli(eta).atZone(ZoneId.of("America/New_York"))
            .format(DateTimeFormatter.ofPattern("h:mm a"))
        manager.notify(31, card("$name · $time"))
        if (left < -90000) { stopSelf(); return }
        if (left > ride.optLong("lead", 180000).coerceIn(180000, 480000)) return
        if (!stopMatches() || stopped) return
        if (prefs.getString("alert-delivered", null) == key(ride)) { stopSelf(); return }
        prefs.edit().putString("alert-delivered", key(ride)).commit()
        manager.createNotificationChannel(NotificationChannel("ride_arrival_vibration", "Ride arrival alerts",
            NotificationManager.IMPORTANCE_HIGH).apply { enableVibration(true) })
        manager.notify(1, Notification.Builder(this, "ride_arrival_vibration")
            .setSmallIcon(R.drawable.ic_launcher).setContentTitle("Approaching $name")
            .setContentText("Train ${ride.optString("num")} · arrival $time")
            .setContentIntent(openIntent).setAutoCancel(true).build())
        stopSelf()
    }

    override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }
    override fun onDestroy() {
        stopped = true
        if (activeKey == key(ride)) activeKey = null
        executor.shutdownNow()
        cookie = ""
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
