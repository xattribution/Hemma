/// The shell is deliberately dumb: it shows the bundled "connect to your
/// server" page, which then navigates the webview to the family's own Hemma
/// instance. All real UI is the PWA served by that server.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Hemma");
}
