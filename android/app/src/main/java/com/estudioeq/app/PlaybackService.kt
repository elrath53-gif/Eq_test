package com.estudioeq.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat.MediaStyle

class PlaybackService : Service() {

    companion object {
        const val CHANNEL_ID = "estudio_eq_playback"
        const val NOTIF_ID = 1001

        const val ACTION_UPDATE = "com.estudioeq.app.ACTION_UPDATE"
        const val ACTION_TOGGLE = "com.estudioeq.app.ACTION_TOGGLE"
        const val ACTION_NEXT = "com.estudioeq.app.ACTION_NEXT"
        const val ACTION_PREV = "com.estudioeq.app.ACTION_PREV"
        const val ACTION_STOP = "com.estudioeq.app.ACTION_STOP"

        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_ARTIST = "extra_artist"
        const val EXTRA_PLAYING = "extra_playing"
        const val EXTRA_POS = "extra_pos"
        const val EXTRA_DUR = "extra_dur"

        @Volatile
        var isRunning: Boolean = false

        @Volatile
        var commandHandler: ((String, Long) -> Unit)? = null
    }

    private lateinit var mediaSession: MediaSessionCompat
    private lateinit var audioManager: AudioManager
    private var focusRequest: AudioFocusRequest? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var noisyRegistered = false
    private var resumeOnFocusGain = false

    private var curTitle: String = "Estudio EQ"
    private var curArtist: String = "Estudio EQ"
    private var curPlaying: Boolean = false
    private var curPosMs: Long = 0L
    private var curDurMs: Long = 0L

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY && curPlaying) {
                commandHandler?.invoke("pause", 0L)
            }
        }
    }

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                resumeOnFocusGain = false
                if (curPlaying) commandHandler?.invoke("pause", 0L)
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                if (curPlaying) {
                    resumeOnFocusGain = true
                    commandHandler?.invoke("pause", 0L)
                }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                if (resumeOnFocusGain) {
                    resumeOnFocusGain = false
                    commandHandler?.invoke("play", 0L)
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        createChannel()

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "EstudioEQ::AudioWakeLock").apply {
            setReferenceCounted(false)
        }

        mediaSession = MediaSessionCompat(this, "EstudioEQSession").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    commandHandler?.invoke("play", 0L)
                }

                override fun onPause() {
                    commandHandler?.invoke("pause", 0L)
                }

                override fun onSkipToNext() {
                    commandHandler?.invoke("next", 0L)
                }

                override fun onSkipToPrevious() {
                    commandHandler?.invoke("prev", 0L)
                }

                override fun onSeekTo(pos: Long) {
                    commandHandler?.invoke("seek", pos)
                }

                override fun onStop() {
                    commandHandler?.invoke("pause", 0L)
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            })
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_TOGGLE -> commandHandler?.invoke("toggle", 0L)
            ACTION_NEXT -> commandHandler?.invoke("next", 0L)
            ACTION_PREV -> commandHandler?.invoke("prev", 0L)
            ACTION_STOP -> {
                commandHandler?.invoke("pause", 0L)
                releaseHolders()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_UPDATE, null -> {
                if (intent != null) {
                    curTitle = intent.getStringExtra(EXTRA_TITLE) ?: curTitle
                    curArtist = intent.getStringExtra(EXTRA_ARTIST) ?: curArtist
                    curPlaying = intent.getBooleanExtra(EXTRA_PLAYING, curPlaying)
                    curPosMs = intent.getLongExtra(EXTRA_POS, curPosMs)
                    curDurMs = intent.getLongExtra(EXTRA_DUR, curDurMs)
                }
                if (curPlaying) {
                    acquireHolders()
                } else {
                    releaseWakeAndNoisy()
                }
                updateSessionAndNotification()
            }
        }
        return START_STICKY
    }

    private fun acquireHolders() {
        try {
            if (wakeLock?.isHeld == false) {
                wakeLock?.acquire(12 * 60 * 60 * 1000L)
            }
        } catch (_: Exception) {
        }

        if (!noisyRegistered) {
            ContextCompat.registerReceiver(
                this,
                noisyReceiver,
                IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                ContextCompat.RECEIVER_EXPORTED
            )
            noisyRegistered = true
        }

        if (focusRequest == null) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(focusListener)
                .build()
        }
        focusRequest?.let { audioManager.requestAudioFocus(it) }
    }

    private fun releaseWakeAndNoisy() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (_: Exception) {
        }
        if (noisyRegistered) {
            try {
                unregisterReceiver(noisyReceiver)
            } catch (_: Exception) {
            }
            noisyRegistered = false
        }
    }

    private fun releaseHolders() {
        releaseWakeAndNoisy()
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
    }

    private fun updateSessionAndNotification() {
        val stateActions = PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_SEEK_TO or
            PlaybackStateCompat.ACTION_STOP

        val playbackState = PlaybackStateCompat.Builder()
            .setActions(stateActions)
            .setState(
                if (curPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                curPosMs,
                if (curPlaying) 1.0f else 0.0f
            )
            .build()
        mediaSession.setPlaybackState(playbackState)

        val metaBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, curTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, curArtist)
        if (curDurMs > 0L) {
            metaBuilder.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, curDurMs)
        }
        try {
            val art = BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher)
            if (art != null) {
                metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art)
            }
        } catch (_: Exception) {
        }
        mediaSession.setMetadata(metaBuilder.build())

        val notification = buildNotification()
        if (curPlaying) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(NOTIF_ID, notification)
            }
        } else {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIF_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPending = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val prevPending = serviceActionPending(ACTION_PREV, 1)
        val togglePending = serviceActionPending(ACTION_TOGGLE, 2)
        val nextPending = serviceActionPending(ACTION_NEXT, 3)

        val toggleIcon = if (curPlaying) R.drawable.ic_notif_pause else R.drawable.ic_notif_play
        val toggleLabel = if (curPlaying) "Pausar" else "Reproducir"

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_eq)
            .setContentTitle(curTitle)
            .setContentText(curArtist)
            .setContentIntent(contentPending)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(curPlaying)
            .addAction(R.drawable.ic_notif_prev, "Anterior", prevPending)
            .addAction(toggleIcon, toggleLabel, togglePending)
            .addAction(R.drawable.ic_notif_next, "Siguiente", nextPending)
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build()
    }

    private fun serviceActionPending(action: String, reqCode: Int): PendingIntent {
        val intent = Intent(this, PlaybackService::class.java).apply {
            this.action = action
        }
        return PendingIntent.getService(
            this,
            reqCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Reproducción de Estudio EQ",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Controles en pantalla de bloqueo y reproducción en segundo plano"
            setShowBadge(false)
        }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(channel)
    }

    override fun onDestroy() {
        isRunning = false
        releaseHolders()
        mediaSession.isActive = false
        mediaSession.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
