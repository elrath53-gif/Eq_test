package com.estudioeq.app

import android.content.Context
import android.view.View
import android.webkit.WebView

class AudioWebView(context: Context) : WebView(context) {
    override fun onWindowVisibilityChanged(visibility: Int) {
        // Evita que Android congele el WebAudio / AudioContext al apagar la pantalla
        // o minimizar la app mientras suena la música en segundo plano.
        super.onWindowVisibilityChanged(View.VISIBLE)
    }
}
