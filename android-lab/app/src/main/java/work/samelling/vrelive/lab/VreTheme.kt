package work.samelling.vrelive.lab

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Color
import android.view.ContextThemeWrapper
import android.view.View
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Native mirror of the CSS semantic palettes. The packed web UI owns the visible
 * theme selector; this class keeps system bars, native dialogs, error states and
 * home-screen RemoteViews consistent with the selected theme.
 */
internal object VreTheme {
    private const val STORE = "vre_live_native_theme"
    private const val KEY = "theme"
    const val ELECTRIC = "electric-stars"
    const val NORD = "nord-light"

    fun current(context: Context): String {
        val saved = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
            .getString(KEY, ELECTRIC)
        return if (saved == NORD) NORD else ELECTRIC
    }

    fun isNord(context: Context): Boolean = current(context) == NORD
    fun save(context: Context, value: String): Boolean {
        if (value != NORD && value != ELECTRIC) return false
        if (current(context) == value) return true
        return context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
            .edit().putString(KEY, value).commit()
    }

    fun background(context: Context): Int = context.getColor(
        if (isNord(context)) R.color.vre_nord_bg else R.color.vre_electric_bg
    )
    fun card(context: Context): Int = context.getColor(
        if (isNord(context)) R.color.vre_nord_card else R.color.vre_electric_card
    )
    fun foreground(context: Context): Int = context.getColor(
        if (isNord(context)) R.color.vre_nord_fg else R.color.vre_electric_fg
    )
    fun muted(context: Context): Int = context.getColor(
        if (isNord(context)) R.color.vre_nord_muted else R.color.vre_electric_muted
    )
    fun line(context: Context, letter: String): Int = context.getColor(
        when {
            isNord(context) && letter == "F" -> R.color.vre_nord_line_f
            isNord(context) && letter == "M" -> R.color.vre_nord_line_m
            !isNord(context) && letter == "F" -> R.color.vre_electric_line_f
            !isNord(context) && letter == "M" -> R.color.vre_electric_line_m
            else -> if (isNord(context)) R.color.vre_nord_fg else R.color.vre_electric_fg
        }
    )

    fun dialogContext(activity: Activity): Context = ContextThemeWrapper(activity,
        if (isNord(activity)) android.R.style.Theme_Material_Light_Dialog_Alert
        else android.R.style.Theme_Material_Dialog_Alert
    )

    fun apply(activity: Activity) {
        val light = isNord(activity)
        val bg = background(activity)
        activity.window.statusBarColor = bg
        activity.window.navigationBarColor = bg
        val view = activity.window.decorView
        @Suppress("DEPRECATION")
        view.systemUiVisibility = if (light)
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        else 0
        activity.findViewById<FrameLayout>(R.id.root)?.setBackgroundColor(bg)
        activity.findViewById<LinearLayout>(R.id.errorPanel)?.setBackgroundColor(bg)
        activity.findViewById<WebView>(R.id.trainWebView)?.setBackgroundColor(bg)
        activity.findViewById<TextView>(R.id.errorTitle)?.setTextColor(foreground(activity))
        activity.findViewById<TextView>(R.id.errorDetail)?.setTextColor(muted(activity))
    }

    fun refreshWidgets(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, DeparturesWidget::class.java))
        if (ids.isNotEmpty()) DeparturesWidget().onUpdate(context, manager, ids)
    }
}
