# Configuration example file structure

```json
{
    "pageId": 1,
    "buttons": {
        "0": {
            "imageName": "mute",
            "click": [{ "action": "HID_KEY", "keycodes": ["SHIFT", "KP_ASTERISK"] }],
            "longPress": [{ "action": "HID_KEY", "keycodes": ["SHIFT", "KP_MINUS"] }]
        },
        "1": {
            "imageName": "welcome",
            "text": "music",
            "click": [{ "action": "CONTROL_KEY", "keycode": "PLAY_PAUSE" }],
            "longPress": [{ "action": "CONTROL_KEY", "keycode": "NEXT" }]
        },
        "2": {
            "imageName": "test",
            "text": "Custom",
            "click": [{ "action": "CMD", "command": "discord::mute" }],
            "longPress": [{ "action": "CMD", "command": "obs::start_stream" }]
        },
    }
}
```
