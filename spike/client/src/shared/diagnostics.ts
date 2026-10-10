import type { Keybinds } from './types';
import { bindLabel } from './keybinds';
import { redactSecrets } from './redact';

/** Facts about this PC's app. No callsign, invite, admin key, or session token. */
export interface DiagnosticsInput {
  appVersion: string;
  platform: string;
  arch: string;
  packaged: boolean;
  privacyAccepted: boolean;
  hotkeysEnabled: boolean;
  overlayOn: boolean;
  wheelOn: boolean;
  soundsOn: boolean;
  soundPtt: boolean;
  soundTx: boolean;
  soundRoger: boolean;
  soundRogerLocal: boolean;
  hangMs: number;
  simpleOn: boolean;
  serverCount: number;
  binds: Keybinds;
}

/** A short report safe to paste into a bug report. */
export function diagnosticsText(input: DiagnosticsInput): string {
  const lines = [
    `Radio Net ${input.appVersion}`,
    `Platform ${input.platform} ${input.arch}`,
    `Installed copy ${input.packaged ? 'yes' : 'no'}`,
    `Privacy note accepted ${input.privacyAccepted ? 'yes' : 'no'}`,
    `Keybinds listening ${input.hotkeysEnabled ? 'yes' : 'no'}`,
    `Overlay ${input.overlayOn ? 'on' : 'off'}`,
    `Channel wheel ${input.wheelOn ? 'on' : 'off'}`,
    `Add-channel sound ${input.soundsOn ? 'on' : 'off'}`,
    `Push-to-talk sound ${input.soundPtt ? 'on' : 'off'}`,
    `Transmit-change sound ${input.soundTx ? 'on' : 'off'}`,
    `Roger beep ${input.soundRoger ? 'on' : 'off'}`,
    `Own roger beep ${input.soundRogerLocal ? 'on' : 'off'}`,
    `Release delay ${input.hangMs} ms`,
    `Simple mode ${input.simpleOn ? 'on' : 'off'}`,
    `Communities saved ${input.serverCount}`,
    `Talk ${bindLabel(input.binds.ptt)}`,
    `Previous channel ${bindLabel(input.binds.prev)}`,
    `Next channel ${bindLabel(input.binds.next)}`,
    `Channel wheel key ${bindLabel(input.binds.wheel)}`,
    `Overlay key ${bindLabel(input.binds.overlay)}`,
  ];
  return redactSecrets(lines.join('\n'));
}
