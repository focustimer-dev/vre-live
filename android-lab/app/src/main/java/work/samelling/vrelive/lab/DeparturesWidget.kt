package work.samelling.vrelive.lab

import android.app.Activity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
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

    override fun onDeleted(context: Context, ids: IntArray) {
        val editor = context.getSharedPreferences("departures_widgets", Context.MODE_PRIVATE).edit()
        for (id in ids) editor.remove(id.toString())
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
        android.app.AlertDialog.Builder(this).setTitle("Choose a VRE station")
            .setItems(codes.map { stations.getString(it) }.toTypedArray()) { _, index ->
                getSharedPreferences("departures_widgets", MODE_PRIVATE).edit()
                    .putString(id.toString(), codes[index]).apply()
                DeparturesWidget().onUpdate(this, manager, intArrayOf(id))
                setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
                finish()
            }
            .setOnCancelListener { finish() }.show()
    }
}
