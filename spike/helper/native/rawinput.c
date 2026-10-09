/*
 * Raw Input filter for the Radio Net push-to-talk helper.
 *
 * Register keyboard and mouse with RegisterRawInputDevices and RIDEV_INPUTSINK
 * on a hidden message window. Do not set RIDEV_NOLEGACY (that would swallow the
 * key so the game never sees it). Do not call SendInput. Do not install a
 * WH_KEYBOARD_LL or WH_MOUSE_LL hook.
 *
 * Every key still arrives in this process. rawinput_filter() is the drop point.
 * Call it before logging, storing, or writing the socket. The only output is
 * talk down (1) or talk up (0) for the one bound control.
 *
 * This file is the native half. The socket half is spike/helper/src/server.ts,
 * which binds 127.0.0.1:47391 and will not key the microphone from a WebSocket
 * message. The addon calls emitTalk. It does not pass the virtual key across.
 */

#include <stddef.h>

int rawinput_filter(int is_mouse, unsigned short code, int down,
                    unsigned short bound_vk, unsigned short bound_button,
                    int *talk_down) {
  if (talk_down == NULL) return 0;
  if (is_mouse) {
    if (bound_button == 0 || code != bound_button) return 0;
  } else if (bound_vk == 0 || code != bound_vk) {
    return 0;
  }
  *talk_down = down ? 1 : 0;
  return 1;
}

#ifdef RAW_INPUT_TEST
int main(void) {
  int talk = 7;
  if (rawinput_filter(0, 0x41, 1, 0x58, 0, &talk) != 0) return 1;
  if (talk != 7) return 2;
  if (rawinput_filter(0, 0x58, 1, 0x58, 0, &talk) != 1 || talk != 1) return 3;
  if (rawinput_filter(0, 0x58, 0, 0x58, 0, &talk) != 1 || talk != 0) return 4;
  if (rawinput_filter(1, 4, 1, 0, 5, &talk) != 0 || talk != 0) return 5;
  if (rawinput_filter(1, 5, 1, 0, 5, &talk) != 1 || talk != 1) return 6;
  if (rawinput_filter(0, 0x1B, 1, 0, 0, &talk) != 0) return 7;
  if (rawinput_filter(0, 0x58, 1, 0x58, 0, NULL) != 0) return 8;
  return 0;
}
#endif
