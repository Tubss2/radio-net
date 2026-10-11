import numpy as np, subprocess
from scipy.io import wavfile
exec(open('/workspace/radio-filter-demos/tools/make_v2_male.py').read().split('\nfiles={}')[0])
OUT='/workspace/radio-filter-demos/v4'
def write(name,y):
    y=np.clip(y,-1,1); w=f'/tmp/v4_{name}.wav'; wavfile.write(w,SR,(y*32767).astype(np.int16))
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',w,'-codec:a','libmp3lame','-b:a','128k',f'{OUT}/{name}.mp3'],check=True); return y
FS=[493.9,587.3,740.0]; FE=[740.0,587.3,440.0]
def soft_seq(notes,fade=0.015,glide=0.010,timbre=(1,0.15,0.05)):
    # one phase-continuous tone; pitch moves between notes with a 10 ms raised-cosine glide centred on each boundary,
    # one 15 ms raised-cosine fade in at the start and out at the end, no level dips between notes
    n=sum(int(round(SR*d)) for _,d in notes); f=np.zeros(n); i=0; bounds=[]
    for fr,d in notes: L=int(round(SR*d)); f[i:i+L]=fr; i+=L; bounds.append(i)
    G=int(SR*glide)
    for b,(f1,f2) in zip(bounds[:-1],zip([a for a,_ in notes][:-1],[a for a,_ in notes][1:])):
        a=b-G//2; w=0.5-0.5*np.cos(np.linspace(0,np.pi,G)); f[a:a+G]=f1+(f2-f1)*w
    ph=2*np.pi*np.cumsum(f)/SR; s=sum(amp*np.sin(k*ph) for amp,k in zip(timbre,(1,3,5))); s=s/np.max(np.abs(s))
    F=int(SR*fade); e=np.ones(n); r=0.5-0.5*np.cos(np.linspace(0,np.pi,F)); e[:F]=r; e[-F:]=r[::-1]
    return s*e*0.35
V={
 'A-down3-long':      ('hard', [0.044,0.044,0.063],[0.044,0.044,0.075]),
 'A-down3-long-soft': ('soft', [0.044,0.044,0.063],[0.044,0.044,0.075]),
 'A-down3-long-softer':('soft',[0.049,0.049,0.070],[0.049,0.049,0.084]),
}
cues={}
for name,(kind,ds,de) in V.items():
    ns=list(zip(FS,ds)); ne=list(zip(FE,de))
    S,E=(seq(ns),seq(ne)) if kind=='hard' else (soft_seq(ns),soft_seq(ne))
    g=10**(-17/20)/rms(S); cues[name]=(S*g,E*g)
    write(f'beeps-{name}-start',pad(S*g,0.3,0.4)); write(f'beeps-{name}-end',pad(E*g,0.3,0.4))
    print(name,kind,'start',ns,'%.0f ms'%(len(S)/SR*1000),'end',ne,'%.0f ms'%(len(E)/SR*1000))
hv=handheld_v2(x,drive=1.6,bias=0.12,ratio=3,hiss_db=-42,floor_mix=0.35)
S,E=cues['A-down3-long-soft']; full=pad(np.concatenate([S,sil(0.12),hv,sil(0.15),E])); write('full-example-A-down3-long-soft',full)
def spoken(t):
    w='/tmp/v4_m.wav'; subprocess.run(['espeak-ng','-v','en-us+m3','-s','160','-w',w,t],check=True)
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',w,'-ar',str(SR),'-ac','1','/tmp/v4_m48.wav'],check=True)
    m=wavfile.read('/tmp/v4_m48.wav')[1]/32768.; return m/np.max(np.abs(m))*0.35
parts=[]
for t,n in [('Number 1. Longer.','A-down3-long'),('Number 2. Longer and softer.','A-down3-long-soft'),('Number 3. Even longer and softer.','A-down3-long-softer')]:
    S,E=cues[n]; parts+=[spoken(t),sil(0.5),S,sil(0.7),E,sil(1.0)]
parts+=[spoken('Number 4. Full example.'),sil(0.4),full,sil(0.3)]
y=write('00-v4-beeps',np.concatenate(parts)); print('combined',round(len(y)/SR,1),'s')
