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
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

internal class Timetable(context: Context) {
    val data = JSONObject(context.assets.open("app/widget-schedule.json").bufferedReader().use { it.readText() })
    val stations = data.getJSONObject("stations")
    private val eastern = ZoneId.of("America/New_York")
    private val clock = DateTimeFormatter.ofPattern("h:mm a", Locale.US)

    data class Row(val train: String, val time: String, val status: String, val line: String,
                   val leaveBy: String? = null)

    data class RouteBoard(val from: String, val to: String, val rows: List<Row>)

    fun routeBoard(a: String, b: String, cache: JSONObject,
                   now: ZonedDateTime = ZonedDateTime.now(eastern)): RouteBoard {
        val date = now.toLocalDate()
        val completed = cache.optJSONObject("completed")
        val endedAt = completed?.optLong("t") ?: 0
        val completedDate = Instant.ofEpochMilli(endedAt).atZone(eastern).toLocalDate()
        val previousOrigin = completed?.optString("from")
        val previousDestination = completed?.optString("dest")
        val outbound = previousOrigin == a && previousDestination == b
        val inbound = previousOrigin == b && previousDestination == a
        val matches = endedAt > 0 && endedAt <= now.toInstant().toEpochMilli() &&
            !completedDate.isBefore(date.minusDays(14)) && (outbound || inbound)
        val returning = if (matches && completedDate == date) outbound else now.hour >= 12
        val (from, to) = if (returning) b to a else a to b
        val today = route(from, to, cache, now, date)
        if (today.isNotEmpty() || !matches) return RouteBoard(from, to, today)

        // A completed outbound ride still leaves the same-day return leg available.
        // Once the day is done, the next commute starts at the configured morning origin.
        for (days in 1L..14L) {
            val serviceDate = date.plusDays(days)
            val label = if (days == 1L) "Tomorrow" else serviceDate.format(serviceDayLabel)
            val rows = route(a, b, cache, now, serviceDate, label)
            if (rows.isNotEmpty()) return RouteBoard(a, b, rows)
        }
        return RouteBoard(from, to, today)
    }

    private val serviceDayLabel = DateTimeFormatter.ofPattern("EEE, MMM d", Locale.US)

    private fun route(from: String, to: String, cache: JSONObject, now: ZonedDateTime,
                      date: LocalDate, previewLabel: String? = null): List<Row> {
        val holidays = data.getJSONArray("noService")
        if (date.dayOfWeek.value >= 6 ||
            (0 until holidays.length()).any { holidays.getString(it) == date.format(DateTimeFormatter.BASIC_ISO_DATE) }
        ) return emptyList()
        val dateKey = date.format(DateTimeFormatter.BASIC_ISO_DATE)
        val reduced = contains(data.optJSONArray("reducedService"), dateKey)
        val trips = data.getJSONArray("trips")
        return (0 until trips.length()).mapNotNull { i ->
            val trip = trips.getJSONObject(i)
            val number = trip.getString("num")
            if (reduced && !contains(data.optJSONArray("sTrains"), number)) return@mapNotNull null
            val stops = trip.getJSONArray("stops")
            val ids = (0 until stops.length()).map { stops.getJSONArray(it).getString(0) }
            val start = ids.indexOf(from)
            if (start < 0 || ids.indexOf(to) <= start) return@mapNotNull null
            val scheduled = date.atStartOfDay(eastern)
                .plusMinutes(stops.getJSONArray(start).getLong(1)).toInstant().toEpochMilli()
            val live = cache.optJSONObject("live")?.optJSONObject(trip.getString("trip"))
            val updated = if (previewLabel == null && fresh(live, now)) live?.optJSONObject("stops")?.optLong(from) ?: 0 else 0
            val departure = updated.takeIf { it > 0 } ?: scheduled
            if (departure < now.toInstant().toEpochMilli()) return@mapNotNull null
            val delay = (departure - scheduled) / 60000
            val lead = leaveLead(cache, from, to, number, dateKey)
            val leaveBy = lead?.let { format(minOf(scheduled, departure) - it * 60000L) }
            departure to Row(number, format(departure),
                when {
                    previewLabel != null -> "$previewLabel · Scheduled"
                    updated <= 0 -> "Scheduled"
                    delay > 0 -> "+$delay min"
                    delay < 0 -> "${-delay} min early"
                    else -> "On time"
                },
                trip.getString("line"), leaveBy)
        }.sortedBy { it.first }.take(2).map { it.second }
    }

    private fun contains(values: org.json.JSONArray?, value: String): Boolean =
        values != null && (0 until values.length()).any { values.optString(it) == value }

    private fun leaveLead(cache: JSONObject, from: String, to: String,
                          train: String, dateKey: String): Int? {
        val overrides = cache.optJSONObject("travelOverrides")?.takeIf { it.optString("date") == dateKey }
            ?.optJSONObject("values")
        val inline = cache.optJSONObject("inlinePlan")
        if (inline != null && inline.optString("date") == dateKey &&
            inline.optString("from") == from && inline.optString("to") == to &&
            inline.optString("train") == train) {
            return lead(inline.optInt("minutes", -1), inline.optInt("platformMinutes", 0),
                inline.optInt("bufferMinutes", 5))
        }
        val profiles = cache.optJSONArray("profiles") ?: return null
        return (0 until profiles.length()).mapNotNull { i ->
            val profile = profiles.optJSONObject(i) ?: return@mapNotNull null
            if (profile.optString("from") != from || profile.optString("to") != to) return@mapNotNull null
            val travel = profile.optInt("travelMinutes", -1)
            lead(overrides?.optInt(profile.optString("id"), travel) ?: travel,
                profile.optInt("platformMinutes", 0), profile.optInt("bufferMinutes", 0))
        }.maxOrNull()
    }

    private fun lead(travel: Int, platform: Int, buffer: Int): Int? =
        if (travel in 0..180 && platform in 0..180 && buffer in 0..180 && travel + platform > 0)
            travel + platform + buffer else null

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

    // A confirmed boarding decision, not a waiting or planned train.
    data class Ribbon(
        val title: String, val eta: String, val detail: String,
        val progress: Int?
    )

    fun rideRibbon(cache: JSONObject): Ribbon? {
        val ride = cache.optJSONObject("ride") ?: return null
        if (!ride.optBoolean("boarded") || ride.optBoolean("waiting")) return null
        val now = ZonedDateTime.now(eastern)
        val age = now.toInstant().toEpochMilli() - ride.optLong("started")
        if (age !in -10000L..28800000L) return null
        val destination = ride.optString("dest")
        if (!stations.has(destination)) return null
        val number = ride.optString("num").ifBlank { "Train" }
        val title = "Train $number · ${stations.getString(destination)}"
        val freshPosition = ride.optBoolean("positionFresh") && fresh(ride, now)
        val etaAt = ride.optLong("eta")
        val remaining = etaAt - now.toInstant().toEpochMilli()
        val eta = if (freshPosition && etaAt > 0 && remaining >= -60000L)
            "${maxOf(0L, (remaining + 59999L) / 60000L)}m" else "ETA —"
        val next = ride.optString("next")
        val nextLabel = if (stations.has(next)) "Next: ${stations.getString(next)}"
            else "Next stop unavailable"
        val detail = "$nextLabel · ${if (freshPosition) "Live estimate" else "Position unconfirmed"}"
        val progress = if (freshPosition && ride.has("progress") && !ride.isNull("progress"))
            ride.optInt("progress").takeIf { it in 0..100 } else null
        return Ribbon(title, eta, detail, progress)
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
        val reduced = contains(data.optJSONArray("reducedService"), dateKey)
        val special = data.optJSONArray("sTrains")
        val next = (0 until rows.length()).asSequence().map { rows.getJSONArray(it) }
            .filter { !reduced || contains(special, it.optString(2)) }
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
            val views = RemoteViews(context.packageName,
                if (VreTheme.isNord(context)) R.layout.departures_widget_nord
                else R.layout.departures_widget)
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
        val ribbon = timetable.rideRibbon(cache)
        if (ribbon != null) {
            val views = RemoteViews(context.packageName,
                if (VreTheme.isNord(context)) R.layout.ride_ribbon_widget_nord
                else R.layout.ride_ribbon_widget)
            views.setTextViewText(R.id.ribbon_title, ribbon.title)
            views.setTextViewText(R.id.ribbon_eta, ribbon.eta)
            views.setTextViewText(R.id.ribbon_detail, ribbon.detail)
            views.setViewVisibility(R.id.ribbon_progress,
                if (ribbon.progress != null) View.VISIBLE else View.GONE)
            ribbon.progress?.let { views.setProgressBar(R.id.ribbon_progress, 100, it, false) }
            val intent = Intent(context, MainActivity::class.java)
            views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(
                context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            ))
            manager.updateAppWidget(id, views)
            return
        }
        val ride = timetable.ride(cache)
        val board = if (ride == null) timetable.routeBoard(a, b, cache) else null
        val rows = board?.rows ?: listOfNotNull(ride?.second)
        val views = RemoteViews(context.packageName,
            if (VreTheme.isNord(context)) R.layout.route_widget_nord else R.layout.route_widget)
        val title = if (board != null)
            "${timetable.stations.getString(board.from)} → ${timetable.stations.getString(board.to)}"
            else ride?.first.orEmpty()
        views.setTextViewText(R.id.widget_station, title)
        views.setTextViewText(R.id.route_first, rows.firstOrNull()?.let { styled(context, it, true) } ?: "No more departures today")
        val width = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
        val second = rows.getOrNull(1)
        views.setViewVisibility(R.id.route_second, if (width >= 240 && second != null) View.VISIBLE else View.GONE)
        if (second != null) views.setTextViewText(R.id.route_second, styled(context, second, false))
        val intent = Intent(context, MainActivity::class.java)
        if (board != null) intent.setAction("work.samelling.vrelive.lab.OPEN_BOARD")
            .putExtra("station", board.from).putExtra("destination", board.to)
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(
            context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        ))
        manager.updateAppWidget(id, views)
    }

    private fun styled(context: Context, row: Timetable.Row, primary: Boolean): CharSequence {
        if (row.time.isEmpty()) return row.status
        val headline = "${row.time}  ${row.train}"
        val leave = row.leaveBy?.let { "\nLeave by $it" }.orEmpty()
        return SpannableString("$headline\n${row.status}$leave").apply {
            setSpan(RelativeSizeSpan(if (primary) 1.36f else 1.22f), 0, row.time.length, 0)
            if (primary) setSpan(android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, row.time.length, 0)
            val color = VreTheme.line(context, row.line)
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
        if (VreTheme.isNord(this)) setTheme(R.style.Theme_VRELiveLab_NordLight)
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
            android.app.AlertDialog.Builder(VreTheme.dialogContext(this)).setTitle(title)
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
