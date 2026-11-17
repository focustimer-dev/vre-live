package work.samelling.vrelive.lab

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Firebase Cloud Messaging entrypoint for the eventual server-authenticated
 * leave-now feature.
 *
 * This PR only configures the client SDK. It must not silently register an FCM
 * token, start train monitoring, or render a notification before the consent
 * and watch-enrollment roundtrip is fully implemented and validated.
 */
class CommuteFirebaseMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // No token uploads, logging, background subscriptions or persistent
        // local token storage until the authenticated device gateway is ready.
        // Firebase token rotation will be handled by that integration.
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        // Deliberately fail closed. PR #20's data-only messages must be
        // matched to a locally confirmed, server-enrolled watch and current
        // global leave-now opt-in before any Android notification is displayed.
        // This gate stays closed until the authorized gateway is implemented.
        if (message.data["kind"] != "leave_now") return
        if (!CommuteCheckIns.enabled(this)) return
        // No locally verified watch enrollment exists in this PR. Drop it.
    }
}
