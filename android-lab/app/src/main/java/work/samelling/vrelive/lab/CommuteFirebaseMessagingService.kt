package work.samelling.vrelive.lab

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Data-only FCM receiver. Android never auto-renders notifications from FCM.
 * Every alert is checked against local global consent and the selected train.
 */
class CommuteFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        CommutePushClient.onTokenRotated(this, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        if (message.data["kind"] != "leave_now") return
        CommutePushClient.displayIfAllowed(this, message.data)
    }
}
