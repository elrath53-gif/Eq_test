# Estudio EQ — App Nativa Android (.apk)

Este proyecto contiene **Estudio EQ** convertido en aplicación nativa real para Android, manteniendo **100% intactos** todos tus ecualizadores (EQ 30, Claridad 16), instrumentos, efectos, vibración, géneros y presets, y añadiendo:

- **Escaneo automático de música (`MediaStore`):** Al abrir la app carga sola todas las canciones del celular sin subir archivos manualmente.
- **Actualización automática en vivo (`ContentObserver`):** Cada vez que descargas o recibes una canción nueva en el teléfono, aparece automáticamente en *Tu música*.
- **Buscador instantáneo y ordenamiento:** Filtra por nombre o artista y ordena por *Recientes* o *A–Z*.
- **Ejecución real en segundo plano (`ForegroundService` + `WakeLock` + `MediaSession`):** Sigue sonando y ecualizando con la pantalla apagada o usando otras apps, con controles en pantalla de bloqueo, barra de notificaciones y audífonos Bluetooth.

---

## Cómo obtener tu archivo `Estudio-EQ.apk` sin instalar nada (desde celular o PC)

### Opción más rápida (desde AI Studio a GitHub)
1. En la barra superior de Google AI Studio, usa la opción de **Guardar / Exportar a GitHub** (o descarga el ZIP desde el botón dentro de la pestaña *Música* y súbelo a un repositorio nuevo en [github.com/new](https://github.com/new)).
2. Apenas se suban los archivos a GitHub, entra a la pestaña **Actions** de tu repositorio: verás que **Compilar APK Estudio EQ** arranca solo y tarda ~3 minutos.
3. Cuando se ponga en verde ✅, entra a la sección **Releases** de tu repositorio en GitHub y toca **`Estudio-EQ.apk`** para descargarlo directo e instalarlo en tu teléfono.

### Recomendación al instalarla en tu celular
- La primera vez que la abras, acepta el permiso de **Música y audio** y **Notificaciones**.
- Dentro de la pestaña **Música**, toca el botón **Activar 2° plano sin límite** para que Android no duerma la app tras mucho rato con la pantalla apagada.
