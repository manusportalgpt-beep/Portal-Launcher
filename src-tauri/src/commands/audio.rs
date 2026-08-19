use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct AudioDevices {
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
}

#[tauri::command]
pub async fn list_audio_devices() -> Result<AudioDevices, String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();

    let inputs: Vec<String> = host.input_devices()
        .map(|devs| devs.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_else(|_| vec!["Default Microphone".to_string()]);

    let outputs: Vec<String> = host.output_devices()
        .map(|devs| devs.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_else(|_| vec!["Default Speaker".to_string()]);

    Ok(AudioDevices { inputs, outputs })
}
