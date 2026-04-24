use tauri::AppHandle;
#[cfg(not(debug_assertions))]
use std::str::FromStr;

const DEFAULT_UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDJCRTBFQTFDRDJDQ0U1NkMKUldSczVjelNIT3JnS3drYUlxc2RLdTloUGcxdndSdHpidkM4UlZROEJ4OXBkTDI2N3JzZUNvRHU=";
#[cfg(not(debug_assertions))]
const DEFAULT_UPDATER_ENDPOINT: &str =
    "https://github.com/PaulElon/Step2Tracker/releases/latest/download/latest.json";

#[cfg(not(debug_assertions))]
use std::env;
#[cfg(not(debug_assertions))]
use std::time::Duration;
#[cfg(not(debug_assertions))]
use tauri_plugin_updater::UpdaterExt;
#[cfg(not(debug_assertions))]
use url::Url;

#[cfg(not(debug_assertions))]
const UPDATER_ENDPOINTS_ENV: &str = "STEP2_UPDATER_ENDPOINTS";
#[cfg(not(debug_assertions))]
const UPDATER_ENDPOINT_ENV: &str = "STEP2_UPDATER_ENDPOINT";
#[cfg(not(debug_assertions))]
const UPDATER_PUBKEY_ENV: &str = "STEP2_UPDATER_PUBKEY";

pub fn updater_pubkey() -> String {
    #[cfg(debug_assertions)]
    {
        DEFAULT_UPDATER_PUBKEY.to_string()
    }

    #[cfg(not(debug_assertions))]
    {
        env::var(UPDATER_PUBKEY_ENV)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_UPDATER_PUBKEY.to_string())
    }
}

#[cfg(not(debug_assertions))]
fn configured_endpoints() -> Vec<Url> {
    let raw = env::var(UPDATER_ENDPOINTS_ENV)
        .ok()
        .or_else(|| env::var(UPDATER_ENDPOINT_ENV).ok())
        .unwrap_or_default();

    let parsed = raw
        .split(['\n', ',', ';'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter_map(|value| Url::parse(value).ok())
        .collect::<Vec<_>>();

    if parsed.is_empty() {
        Url::from_str(DEFAULT_UPDATER_ENDPOINT)
            .map(|url| vec![url])
            .unwrap_or_default()
    } else {
        parsed
    }
}

#[cfg(debug_assertions)]
pub fn spawn_update_check(_: AppHandle) {}

#[cfg(not(debug_assertions))]
pub fn spawn_update_check(app: AppHandle) {
    let endpoints = configured_endpoints();
    if endpoints.is_empty() {
        return;
    }

    let pubkey = updater_pubkey();

    tauri::async_runtime::spawn(async move {
        let updater = match app
            .updater_builder()
            .pubkey(pubkey)
            .endpoints(endpoints)
        {
            Ok(builder) => match builder.timeout(Duration::from_secs(30)).build() {
                Ok(updater) => updater,
                Err(error) => {
                    eprintln!("Updater disabled: {error}");
                    return;
                }
            },
            Err(error) => {
                eprintln!("Updater disabled: {error}");
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                if let Err(error) = update.download_and_install(|_, _| {}, || {}).await {
                    eprintln!("Updater install failed: {error}");
                    return;
                }

                app.restart();
            }
            Ok(None) => {}
            Err(error) => {
                eprintln!("Updater check failed: {error}");
            }
        }
    });
}
