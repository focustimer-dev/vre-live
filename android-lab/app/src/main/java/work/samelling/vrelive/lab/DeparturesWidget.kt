package work.samelling.vrelive.lab

import android.app.Activity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.ComponentName
import android.graphics.Color
import android.text.SpannableString
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import android.view.View
import java.time.Instant
import android.content.Intent
import android.os.Bundle
import android.widget.RemoteViews
import org.json.JSONObject
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

private class Timetable(context: Context) {
    val data = JSONObject(context.assets.open("app/widget-schedule.json").bufferedReader().use { it.readText() })
    val stations = data.getJSONObject("stations")
    private val eastern = ZoneId.of("America/New_York")
    private val clock = DateTimeFormatter.ofPattern("h:mm a", Locale.US)

    data class Row(val train: String, val time: String, val status: String, val line: String)

    fun direction(a: String, b: String): Pair<String, String> =
        if (ZonedDateTime.now(eastern).hour < 12) a to b else b to a

    fun route(from: String, to: String, cache: JSONObject): List<Row> {
        val now = ZonedDateTime.now(eastern)
        val date = now.toLocalDate()
        val holidays = data.getJSONArray("noService")
        if (date.dayOfWeek.value >= 6 ||
            (0 until holidays.length()).any { holidays.getString(it) == date.format(DateTimeFormatter.BASIC_ISO_DATE) }
        ) return emptyList()
        val trips = data.getJSONArray("trips")
        return (0 until trips.length()).mapNotNull { i ->
            val trip = trips.getJSONObject(i)
            val stops = trip.getJSONArray("stops")
            val ids = (0 until stops.length()).map { stops.getJSONArray(it).getString(0) }
            val start = ids.indexOf(from)
            if (start < 0 || ids.indexOf(to) <= start) return@mapNotNull null
            val scheduled = date.atStartOfDay(eastern)
                .plusMinutes(stops.getJSONArray(start).getLong(1)).toInstant().toEpochMilli()
            val live = cache.optJSONObject("live")?.optJSONObject(trip.getString("trip"))
            val updated = if (fresh(live, now)) live?.optJSONObject("stops")?.optLong(from) ?: 0 else 0
            val departure = updated.takeIf { it > 0 } ?: scheduled
            if (departure < now.toInstant().toEpochMilli()) return@mapNotNull null
            val delay = (departure - scheduled) / 60000
            departure to Row(trip.getString("num"), format(departure),
                when {
                    updated <= 0 -> "Scheduled"
                    delay > 0 -> "+$delay min"
                    delay < 0 -> "${-delay} min early"
                    else -> "On time"
                },
                trip.getString("line"))
        }.sortedBy { it.first }.take(2).map { it.second }
    }

    fun ride(cache: JSONObject): Pair<String, Row>? {
        val ride = cache.optJSONObject("ride") ?: return null
        val now = ZonedDateTime.now(eastern)
        val age = now.toInstant().toEpochMilli() - ride.optLong("started")
        if (age !in 0L..28800000L) return null
        val station = ride.optString("dest")
        if (!stations.has(station)) return null
        val eta = ride.optLong("eta")
        val live = eta > 0 && fresh(ride, now)
        if (ride.optBoolean("waiting")) {
            if (age > 14400000L) return null
            val scheduled = ride.optLong("scheduled")
            val showScheduled = scheduled > now.toInstant().toEpochMilli()
            val approaching = live && eta >= now.toInstant().toEpochMilli() - 60000
            return "Waiting at ${stations.getString(station)}" to Row(ride.optString("num", "Train"),
                if (approaching) format(eta) else if (showScheduled) format(scheduled) else "",
                if (approaching) "Live arrival" else if (showScheduled) "Scheduled arrival" else "Arrival unconfirmed", "")
        }
        return "Arrival at ${stations.getString(station)}" to Row(ride.optString("num", "Train"),
            if (live) format(eta) else "", if (live) "Live arrival" else "Live ETA unavailable", "")
    }

    private fun fresh(item: JSONObject?, now: ZonedDateTime): Boolean =
        item != null && now.toInstant().toEpochMilli() - item.optLong("ts") in -60000L..300000L

    private fun format(value: Long): String = Instant.ofEpochMilli(value).atZone(eastern).format(clock)

    fun departures(station: String, now: ZonedDateTime = ZonedDateTime.now(eastern)): String {
        val date = now.toLocalDate()
        val holidays = data.getJSONArray("noService")
        val dateKey = date.format(DateTimeFormatter.BASIC_ISO_DATE)
        if (date.dayOfWeek.value >= 6 || (0 until holidays.length()).any { holidays.getString(it) == dateKey }) {
            return "No scheduled service today"
        }
        val rows = data.getJSONObject("departures").optJSONArray(station)
            ?: return "No scheduled departures today"
        val next = (0 until rows.length()).asSequence().map { rows.getJSONArray(it) }
            .map { row ->
                val minute = row.getInt(0)
                val departure = date.atStartOfDay(eastern).plusHours((minute / 60).toLong())
                    .plusMinutes((minute % 60).toLong())
                departure to row.getString(1)
            }
            .filter { (departure, _) -> departure.isAfter(now) }
            .take(2)
            .map { (departure, destination) -> "${departure.format(clock)}  ·  $destination" }
            .toList()
        return if (next.isEmpty()) "No more scheduled departures today"
            else (listOf("Scheduled · Eastern time") + next).joinToString("\n")
    }
}

class DeparturesWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val timetable = Timetable(context)
        for (id in ids) {
            val station = context.getSharedPreferences("departures_widgets", Context.MODE_PRIVATE)
                .getString(id.toString(), null) ?: continue
            val prefs = context.getSharedPreferences("departures_widgets", Context.MODE_PRIVATE)
            val destination = prefs.getString("destination-$id", null)
            if (destination != null) {
                renderRoute(context, manager, id, timetable, station, destination)
                continue
            }
            val views = RemoteViews(context.packageName, R.layout.departures_widget)
            views.setTextViewText(R.id.widget_station, timetable.stations.getString(station))
            views.setTextViewText(R.id.widget_times, timetable.departures(station))
            val board = Intent(context, MainActivity::class.java)
                .setAction("work.samelling.vrelive.lab.OPEN_BOARD")
                .putExtra("station", station)
            views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(
                context, id, board, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            ))
            manager.updateAppWidget(id, views)
        }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context, manager: AppWidgetManager, id: Int, options: Bundle
    ) = onUpdate(context, manager, intArrayOf(id))

    private fun renderRoute(
        context: Context, manager: AppWidgetManager, id: Int, timetable: Timetable, a: String, b: String
    ) {
        val prefs = context.getSharedPreferences("departures_widgets", Context.MODE_PRIVATE)
        val cache = runCatching { JSONObject(prefs.getString("snapshot", "{}").orEmpty()) }.getOrDefault(JSONObject())
        val (from, to) = timetable.direction(a, b)
        val ride = timetable.ride(cache)
        val rows = if (ride == null) timetable.route(from, to, cache) else listOf(ride.second)
        val views = RemoteViews(context.packageName, R.layout.route_widget)
        val title = if (ride == null) "${timetable.stations.getString(from)} → ${timetable.stations.getString(to)}"
            else ride.first
        views.setTextViewText(R.id.widget_station, title)
        views.setTextViewText(R.id.route_first, rows.firstOrNull()?.let { styled(it, true) } ?: "No more departures today")
        val width = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
        val second = rows.getOrNull(1)
        views.setViewVisibility(R.id.route_second, if (width >= 240 && second != null) View.VISIBLE else View.GONE)
        if (second != null) views.setTextViewText(R.id.route_second, styled(second, false))
        val intent = Intent(context, MainActivity::class.java)
        if (ride == null) intent.setAction("work.samelling.vrelive.lab.OPEN_BOARD").putExtra("station", from).putExtra("destination", to)
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(
            context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        ))
        manager.updateAppWidget(id, views)
    }

    private fun styled(row: Timetable.Row, primary: Boolean): CharSequence {
        if (row.time.isEmpty()) return row.status
        val headline = "${row.time}  ${row.train}"
        return SpannableString("$headline\n${row.status}").apply {
            setSpan(RelativeSizeSpan(if (primary) 1.36f else 1.22f), 0, row.time.length, 0)
            if (primary) setSpan(android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, row.time.length, 0)
            val color = when (row.line) {
                "F" -> Color.rgb(255, 127, 127)
                "M" -> Color.rgb(133, 184, 255)
                else -> Color.WHITE
            }
            setSpan(ForegroundColorSpan(color), headline.length - row.train.length, headline.length, 0)
        }
    }

    companion object {
        fun cache(context: Context, payload: String) {
            if (payload.length > 120000 || runCatching { JSONObject(payload) }.isFailure) return
            val prefs = context.getSharedPreferences("departures_widgets", Context.MODE_PRIVATE)
            if (prefs.getString("snapshot", null) == payload) return
            prefs.edit().putString("snapshot", payload).apply()
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, DeparturesWidget::class.java))
            if (ids.isNotEmpty()) DeparturesWidget().onUpdate(context, manager, ids)
        }
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        val editor = context.getSharedPreferences("departures_widgets", Context.MODE_PRIVATE).edit()
        for (id in ids) editor.remove(id.toString()).remove("destination-$id")
        editor.apply()
    }
}

class DeparturesSetup : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        setResult(RESULT_CANCELED)
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        val manager = AppWidgetManager.getInstance(this)
        if (manager.getAppWidgetInfo(id)?.provider?.className != DeparturesWidget::class.java.name) {
            finish()
            return
        }
        val stations = Timetable(this).stations
        val codes = stations.keys().asSequence().sortedBy { stations.getString(it) }.toList()
        fun choose(title: String, options: List<String>, onSelected: (String) -> Unit) {
            android.app.AlertDialog.Builder(this).setTitle(title)
                .setItems(options.map { stations.getString(it) }.toTypedArray()) { _, index ->
                    onSelected(options[index])
                }
                .setOnCancelListener { finish() }.show()
        }
        choose("Morning origin", codes) { origin ->
            choose("Morning destination", codes.filter { it != origin }) { destination ->
                getSharedPreferences("departures_widgets", MODE_PRIVATE).edit()
                    .putString(id.toString(), origin)
                    .putString("destination-$id", destination).apply()
                DeparturesWidget().onUpdate(this, manager, intArrayOf(id))
                setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
                finish()
            }
        }
    }
}
