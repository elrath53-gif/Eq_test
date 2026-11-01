package com.estudioeq.app

import android.content.ContentUris
import android.content.Context
import android.content.res.AssetFileDescriptor
import android.provider.MediaStore
import android.webkit.WebResourceResponse
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.InputStream

object MusicScanner {

    fun queryTracksJson(context: Context): String {
        val arr = JSONArray()
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.DATE_ADDED,
            MediaStore.Audio.Media.IS_MUSIC
        )
        val selection = "(${MediaStore.Audio.Media.IS_MUSIC} != 0 OR ${MediaStore.Audio.Media.MIME_TYPE} LIKE 'audio/%')"
        val sortOrder = "${MediaStore.Audio.Media.DATE_ADDED} DESC"

        try {
            context.contentResolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                projection,
                selection,
                null,
                sortOrder
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                val artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
                val durCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
                val addedCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)

                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idCol)
                    val durationMs = cursor.getLong(durCol)
                    // Ignora sonidos cortos de notificación (< 3 s) cuando tienen duración conocida
                    if (durationMs in 1..2999) continue

                    val rawTitle = cursor.getString(titleCol)?.trim().orEmpty()
                    val displayName = cursor.getString(nameCol)?.trim().orEmpty()
                    val cleanFallback = displayName.substringBeforeLast('.', displayName)
                    val title = if (rawTitle.isNotEmpty() && !rawTitle.equals("<unknown>", ignoreCase = true)) {
                        rawTitle
                    } else if (cleanFallback.isNotEmpty()) {
                        cleanFallback
                    } else {
                        "Pista $id"
                    }

                    val rawArtist = cursor.getString(artistCol)?.trim().orEmpty()
                    val artist = if (rawArtist.isNotEmpty() && !rawArtist.equals("<unknown>", ignoreCase = true)) {
                        rawArtist
                    } else {
                        ""
                    }

                    val dateAdded = cursor.getLong(addedCol)
                    val obj = JSONObject()
                    obj.put("id", id)
                    obj.put("name", title)
                    obj.put("artist", artist)
                    obj.put("duration", if (durationMs > 0) durationMs / 1000L else 0L)
                    obj.put("dateAdded", dateAdded)
                    obj.put("url", "https://estudioeq.local/media/$id")
                    arr.put(obj)
                }
            }
        } catch (_: Exception) {
        }
        return arr.toString()
    }

    fun openMediaResponse(
        context: Context,
        mediaId: Long,
        requestHeaders: Map<String, String>
    ): WebResourceResponse {
        val uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mediaId)
        try {
            val mimeType = context.contentResolver.getType(uri) ?: "audio/mpeg"
            val afd = context.contentResolver.openAssetFileDescriptor(uri, "r")
                ?: return empty404()
            val totalLength = afd.length
            val rawStream = afd.createInputStream()

            val rangeHeader = requestHeaders.entries
                .firstOrNull { it.key.equals("Range", ignoreCase = true) }
                ?.value

            if (!rangeHeader.isNullOrBlank() && rangeHeader.startsWith("bytes=") && totalLength > 0L) {
                val spec = rangeHeader.removePrefix("bytes=").trim()
                val parts = spec.split('-', limit = 2)
                val start = parts[0].trim().toLongOrNull()?.coerceIn(0L, totalLength - 1L) ?: 0L
                val end = parts.getOrNull(1)?.trim()?.takeIf { it.isNotEmpty() }
                    ?.toLongOrNull()?.coerceIn(start, totalLength - 1L)
                    ?: (totalLength - 1L)

                skipFully(rawStream, start)
                val contentLength = (end - start + 1L).coerceAtLeast(0L)
                val bounded = BoundedAssetInputStream(afd, rawStream, contentLength)
                val headers = mapOf(
                    "Accept-Ranges" to "bytes",
                    "Content-Range" to "bytes $start-$end/$totalLength",
                    "Content-Length" to contentLength.toString(),
                    "Access-Control-Allow-Origin" to "*",
                    "Cache-Control" to "no-store"
                )
                return WebResourceResponse(mimeType, null, 206, "Partial Content", headers, bounded)
            }

            val maxBytes = if (totalLength > 0L) totalLength else Long.MAX_VALUE
            val bounded = BoundedAssetInputStream(afd, rawStream, maxBytes)
            val headers = mutableMapOf(
                "Accept-Ranges" to "bytes",
                "Access-Control-Allow-Origin" to "*",
                "Cache-Control" to "no-store"
            )
            if (totalLength > 0L) {
                headers["Content-Length"] = totalLength.toString()
            }
            return WebResourceResponse(mimeType, null, 200, "OK", headers, bounded)
        } catch (_: Exception) {
            return empty404()
        }
    }

    private fun skipFully(stream: InputStream, bytesToSkip: Long) {
        var remaining = bytesToSkip
        val scratch = ByteArray(8192)
        while (remaining > 0L) {
            val skipped = stream.skip(remaining)
            if (skipped > 0L) {
                remaining -= skipped
            } else {
                val toRead = minOf(remaining, scratch.size.toLong()).toInt()
                val read = stream.read(scratch, 0, toRead)
                if (read <= 0) break
                remaining -= read.toLong()
            }
        }
    }

    private fun empty404(): WebResourceResponse {
        return WebResourceResponse(
            "text/plain",
            "UTF-8",
            404,
            "Not Found",
            mapOf("Access-Control-Allow-Origin" to "*"),
            ByteArrayInputStream(ByteArray(0))
        )
    }

    private class BoundedAssetInputStream(
        private val afd: AssetFileDescriptor,
        private val delegate: InputStream,
        private var remaining: Long
    ) : InputStream() {
        private var closed = false

        override fun read(): Int {
            if (remaining <= 0L) return -1
            val b = delegate.read()
            if (b != -1) remaining--
            return b
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (remaining <= 0L) return -1
            val maxRead = minOf(len.toLong(), remaining).toInt()
            val count = delegate.read(b, off, maxRead)
            if (count > 0) remaining -= count.toLong()
            return count
        }

        override fun close() {
            if (closed) return
            closed = true
            try {
                delegate.close()
            } catch (_: Exception) {
            }
            try {
                afd.close()
            } catch (_: Exception) {
            }
        }
    }
}
