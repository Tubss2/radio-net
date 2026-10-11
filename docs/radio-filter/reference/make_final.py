import numpy as np, subprocess
from scipy.io import wavfile
SR=48000; R='/workspace/radio-filter-demos'
def load(p):
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',p,'-ar',str(SR),'-ac','1','/tmp/fin_l.wav'],check=True)
    return wavfile.read('/tmp/fin_l.wav')[1]/32768.
def trim(y,thr=2e-3):
    i=np.where(np.abs(y)>thr)[0]; return y[max(0,i[0]-48):i[-1]+48]
def rms(y): return np.sqrt(np.mean(y[np.abs(y)>1e-3]**2))
def match(y,db=-20): y=y*10**(db/20)/rms(y); m=np.max(np.abs(y)); return y if m<0.95 else y/m*0.95
def spoken(t):
    subprocess.run(['espeak-ng','-v','en-us+m3','-s','160','-w','/tmp/fin_m.wav',t],check=True)
    m=load('/tmp/fin_m.wav'); return m/np.max(np.abs(m))*0.35
sil=lambda s: np.zeros(int(SR*s))
S=trim(load(f'{R}/v4/beeps-A-down3-long-start.mp3')); E=trim(load(f'{R}/v4/beeps-A-down3-long-end.mp3'))
hA=match(trim(load(f'{R}/v2-male/02-handheld-v2a.mp3'))); hB=match(trim(load(f'{R}/v2-male/02-handheld-v2b.mp3')))
dg=match(trim(load(f'{R}/modern-research/v2/01-codec2-2400.mp3')))
tx=lambda v: np.concatenate([S,sil(0.12),v,sil(0.15),E])
items=[('Number 1. Beeps.',np.concatenate([S,sil(0.7),E])),('Number 2. Handheld.',tx(hA)),('Number 3. Degraded.',tx(hB)),
       ('Number 4. Digital.',tx(dg))]
parts=[sil(0.2)]
for t,a in items: parts+=[spoken(t),sil(0.4),a,sil(0.8)]
y=np.clip(np.concatenate(parts),-1,1); wavfile.write('/tmp/fin_all.wav',SR,(y*32767).astype(np.int16))
subprocess.run(['ffmpeg','-y','-loglevel','error','-i','/tmp/fin_all.wav','-codec:a','libmp3lame','-b:a','128k',f'{R}/final/00-final-picks.mp3'],check=True)
print(round(len(y)/SR,1),'s', 'rms dB voice:',[round(20*np.log10(rms(a)),1) for a in (hA,hB,dg)],'beep',round(20*np.log10(rms(S)),1))
