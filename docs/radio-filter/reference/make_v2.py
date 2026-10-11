import numpy as np, subprocess, os
from scipy import signal
from scipy.io import wavfile
V1='/workspace/radio-filter-demos/tools/make_demos.py'
exec(open(V1).read().split('files={}')[0])   # reuses x, bp, sat, crush, static, gate_env, lpc_vocoder, env_tone, roger
OUT='/workspace/radio-filter-demos/v2'; rng=np.random.default_rng(11)
def rms(y): return np.sqrt(np.mean(y[np.abs(y)>1e-4]**2))
def loud(y,target_db=-20,peak=0.89):
    y=y*(10**(target_db/20)/rms(y)); m=np.max(np.abs(y))
    if m>peak: y=np.tanh(y/peak*1.0)*peak if m<1.6*peak else y/m*peak
    return y
def follower(y,att,rel):
    a=np.exp(-1/(SR*att)); r=np.exp(-1/(SR*rel)); e=np.zeros_like(y); v=0; ay=np.abs(y)
    for i in range(len(y)):
        c=ay[i]; v = a*v+(1-a)*c if c>v else r*v+(1-r)*c; e[i]=v
    return e
def agc(y,thr_db,ratio,att=0.005,rel=0.18):
    e=follower(y,att,rel)+1e-6; db=20*np.log10(e); over=np.maximum(db-thr_db,0)
    return y*10**(-over*(1-1/ratio)/20)
def speech_env(y,att=0.02,rel=0.12):
    e=follower(y,att,rel); return np.clip(e/np.percentile(e,95),0,1)
def tx_window(n,fade=0.015):
    w=np.ones(n); f=int(SR*fade); w[:f]=np.linspace(0,1,f); w[-f:]=np.linspace(1,0,f); return w
def warm(y,drive,bias):  # asymmetric soft clip -> even harmonics (valve/transformer-like warmth)
    return (np.tanh(drive*(y+bias))-np.tanh(drive*bias))/drive
def hiss_bed(n,ref,db):
    w=rng.standard_normal(n); s=bp(w,300,3400,2); s=s/np.std(s)
    return s*rms(ref)*10**(db/20)
def handheld_v2(y,drive,bias,ratio,hiss_db,floor_mix):
    v=bp(y,300,3400,4); v=v/np.max(np.abs(v))*0.8
    v=warm(v,drive,bias); v=bp(v,280,3600,2)
    n=hiss_bed(len(v),v,hiss_db)
    env=speech_env(v); n=n*(floor_mix+(1-floor_mix)*env)*tx_window(len(v))  # mostly while talking, low floor while carrier is up
    mix=v+n
    mix=agc(mix,-24+20*np.log10(np.max(np.abs(mix))),ratio)  # AGC on voice+noise -> floor breathes up between words
    return loud(mix)
def degraded_v2(y,static_db):
    z=bp(y,400,2800,6); z=sat(z/np.max(np.abs(z))*0.9,6); z=crush(z,7,11025); z=bp(z,350,3200,2)
    z=z+hiss_bed(len(z),z,static_db)*tx_window(len(z)); return loud(z)
def modern_v2(y,wet):
    d=bp(y,300,3400,6); d8=signal.resample_poly(d,1,6); d8=np.round(d8/np.max(np.abs(d8))*2047)/2047  # 8 kHz, 12-bit
    d=signal.resample_poly(d8,6,1)[:len(y)]; d=d/np.max(np.abs(d))
    voc=lpc_vocoder(y); voc=voc/rms(voc)*rms(d)
    m=(1-wet)*d+wet*voc; m=bp(m,300,3400,4)
    m=m*gate_env(m,-40)  # hard gate, dead silence between phrases, no hiss
    return loud(m)
# ---- beeps: soft-square timbre (odd harmonics, rolled off), soft attack ----
def note(f,dur,peak=0.35,att=0.008,rel=0.012,timbre=(1,0.30,0.12)):
    t=np.arange(int(SR*dur))/SR; s=sum(a*np.sin(2*np.pi*f*k*t) for a,k in zip(timbre,(1,3,5)))
    s=s/np.max(np.abs(s)); e=np.ones_like(s); A=int(SR*att); R=int(SR*rel)
    e[:A]=np.sin(np.linspace(0,np.pi/2,A))**2; e[-R:]=np.cos(np.linspace(0,np.pi/2,R))**2; return s*e*peak
def seq(notes,gap=0.0,**kw):
    out=[]
    for f,d in notes: out+= [note(f,d,**kw),np.zeros(int(SR*gap))]
    return np.concatenate(out)
BEEPS={
 # A "trill": three quick rising notes / three falling notes ending low
 'A':(seq([(587,0.035),(698,0.035),(880,0.05)]), seq([(880,0.035),(698,0.035),(523,0.06)])),
 # B "zigzag chirp" (closest to reference chirp 1: 4 short notes, no gaps, square-ish)
 'B':(seq([(659,0.028),(523,0.028),(587,0.028),(784,0.045)],timbre=(1,0.40,0.20)),
      seq([(784,0.028),(587,0.028),(659,0.028),(494,0.055)],timbre=(1,0.40,0.20))),
 # C "pulse triplet" (like reference chirp 2: 3 pulses with short dips, but stepping), purer tone
 'C':(seq([(523,0.04),(659,0.04),(784,0.05)],gap=0.012,timbre=(1,0.12,0.0)),
      seq([(698,0.04),(698,0.04),(587,0.04),(466,0.06)],gap=0.012,timbre=(1,0.12,0.0))),
}
sil=lambda s: np.zeros(int(SR*s))
def pad(y,a=0.2,b=0.3): return np.concatenate([sil(a),y,sil(b)])
def write(name,y):
    y=np.clip(y,-1,1); w=f'/tmp/v2_{name}.wav'; wavfile.write(w,SR,(y*32767).astype(np.int16))
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',w,'-codec:a','libmp3lame','-b:a','128k',f'{OUT}/{name}.mp3'],check=True)
    return y
files={}
files['01-clean']=pad(loud(x))
files['02-handheld-v2a']=pad(handheld_v2(x,drive=1.6,bias=0.12,ratio=3,hiss_db=-42,floor_mix=0.35))
files['02-handheld-v2b']=pad(handheld_v2(x,drive=2.6,bias=0.20,ratio=6,hiss_db=-36,floor_mix=0.5))
files['03-degraded-v2a']=pad(degraded_v2(x,-45))
files['03-degraded-v2b']=pad(degraded_v2(x,-35))
files['04-modern-v2a']=pad(modern_v2(x,0.20))
files['04-modern-v2b']=pad(modern_v2(x,0.30))
cue_gain=10**(-20/20)/rms(BEEPS['A'][0])   # cues sit around -20 dBFS RMS like the voice, then -4 dB
for k,(s,e) in BEEPS.items():
    g=10**(-17/20)/rms(s)
    files[f'beeps-{k}-start']=pad(s*g,0.3,0.4); files[f'beeps-{k}-end']=pad(e*g,0.3,0.4)
ba=[]
for k,(s,e) in BEEPS.items():
    g=10**(-17/20)/rms(s); ba+=[s*g,sil(0.7),e*g,sil(1.4)]
files['beeps-all']=pad(np.concatenate(ba),0.3,0.2)
for k,(s,e) in BEEPS.items():
    g=10**(-17/20)/rms(s)
    voice=np.concatenate([x/np.max(np.abs(x)),sil(0.05),roger()*1.2])
    hv=handheld_v2(voice,drive=1.6,bias=0.12,ratio=3,hiss_db=-42,floor_mix=0.35)
    files[f'09-full-{k}']=pad(np.concatenate([s*g,sil(0.12),hv,sil(0.2),e*g]))
for k,v in files.items(): files[k]=write(k,v); print(k,round(len(v)/SR,2),'s')
# combined with spoken markers
order=[k for k in files if not (k.startswith('beeps-') and k!='beeps-all')]; parts=[]
def spoken(txt):
    w='/tmp/v2_marker.wav'; subprocess.run(['espeak-ng','-v','en-us','-s','165','-w',w,txt],check=True)
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',w,'-ar',str(SR),'-ac','1','/tmp/v2_marker48.wav'],check=True)
    sr,m=wavfile.read('/tmp/v2_marker48.wav'); m=m/32768.; return m/np.max(np.abs(m))*0.35
label={k:k.replace('beeps-all','beep sets A B C, start then end').replace('-',' ').replace('v2a','version 2 A').replace('v2b','version 2 B').replace('beeps','beeps').replace('09 full','full example') for k in order}
for k in order: parts+=[spoken(label[k]),sil(0.4),files[k],sil(0.6)]
write('00-v2-all',np.concatenate(parts)); print('ORDER',order)
