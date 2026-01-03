# USB API Layout

**VENDOR_ID:** 0x303a

**PRODUCT_ID:** 0x1001

## 64 Byte HID Report

| Byte Index | Name        | Type        | Desc                        |
| ---------- | ----------- | ----------- | --------------------------- |
| **0**      | `Report ID` | `uint8`     | mostly `0` (lib handles it) |
| **1**      | `Command`   | `uint8`     | type of command             |
| **2**      | `Seq (MSB)` | `uint8`     | Sequence High Byte.         |
| **3**      | `Seq (LSB)` | `uint8`     | Sequence Low Byte.          |
| **4 - 63** | `Payload`   | `uint8[60]` | Daten (Action/Image/Json).  |

## OpCodes

```cpp
// 0x0X device info
CMD_VERSION = 0x01,
CMD_DEVICE_NAME = 0x02,

// 0x1X file transfer
CMD_FILE_START = 0x10,
CMD_FILE_CHUNK = 0x11,
CMD_FILE_END = 0x12,

// 0x2X code related
CMD_TRIGGER_ACTION = 0x20,
CMD_PAGE = 0x21,

//0x7X command specifics
CMD_ACK = 0x7F,
CMD_ERROR = 0x80
```
