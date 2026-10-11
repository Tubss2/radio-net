import numpy as np, subprocess
src=open('/workspace/radio-filter-demos/tools/make_modern_research.py').read().split('V={}')[0]
exec(src)   # reuses run, rms, level, bp, follower, hard_gate, comp, codec2, finish
OUT='/workspace/radio-filter-demos/modern-research/v2'; T='/tmp/mr2_'
def soft_gate(y,thr_db=-42,floor_db=-30,att=0.002,rel=0.06):
    # downward expander: smooth gain, short release, quiet floor instead of hard mute -> no chopping
    e=follower(y,0.003,0.04)+1e-9; db=20*np.log10(e/np.max(np.abs(y)))
    tgt=np.where(db>thr_db,1.0,10**(floor_db/20))
    a=np.exp(-1/(SR*att)); r=np.exp(-1/(SR*rel)); g=np.empty_like(tgt); v=tgt[0]
    for i in range(len(tgt)):
        t=tgt[i]; v=a*v+(1-a)*t if t>v else r*v+(1-r)*t; g[i]=v
    return y*g
def finish_light(y):
    y=bp(y,250,3400,2); y=soft_gate(y); y=comp(y,thr_db=-18,ratio=2); return level(y)
V={}
V['01-codec2-2400']=finish(codec2('2400',tag='a'),300,3400,1.4)
V['02-codec2-1600']=finish(codec2('1600',tag='b'),300,3300,1.5)
V['03-codec2-1400']=finish(codec2('1400',tag='c'),300,3200,1.6)
V['04-codec2-1300-light']=finish_light(codec2('1300',tag='d'))
V['05-codec2-1600-light']=finish_light(codec2('1600',tag='e'))
for k,y in V.items():
    wavfile.write(T+k+'.wav',SR,(y*32767).astype(np.int16))
    run('ffmpeg','-y','-loglevel','error','-i',T+k+'.wav','-codec:a','libmp3lame','-b:a','128k',f'{OUT}/{k}.mp3')
    print(k, round(20*np.log10(rms(y)),1),'dB rms', round(20*np.log10(np.max(np.abs(y))),1),'dB peak')
def spoken(txt):
    w=T+'lab.wav'; run('espeak-ng','-v','en-us+m3','-s','150','-w',w,txt)
    run('ffmpeg','-y','-loglevel','error','-i',w,'-ar',str(SR),'-ac','1',T+'lab48.wav')
    m=wavfile.read(T+'lab48.wav')[1]/32768.; return m/np.max(np.abs(m))*0.35
sil=lambda s: np.zeros(int(SR*s))
run('ffmpeg','-y','-loglevel','error','-i','/workspace/radio-filter-demos/modern-research/02-codec2-1300-buzzy.mp3','-ar',str(SR),'-ac','1',T+'ref.wav')
ref=level(wavfile.read(T+'ref.wav')[1]/32768.)
parts=[spoken('Reference.'),sil(0.5),ref,sil(1.0)]
for i,k in enumerate(V,1): parts+=[spoken(f'Number {i}.'),sil(0.5),V[k],sil(1.0)]
y=np.clip(np.concatenate(parts),-1,1); wavfile.write(T+'all.wav',SR,(y*32767).astype(np.int16))
run('ffmpeg','-y','-loglevel','error','-i',T+'all.wav','-codec:a','libmp3lame','-b:a','128k',f'{OUT}/00-modern-v2.mp3')
print('total',round(len(y)/SR,1),'s')
