import numpy as np, subprocess
from scipy import signal
from scipy.io import wavfile
SR=48000; SRC='/workspace/radio-filter-demos/src-male/speech.wav'; OUT='/workspace/radio-filter-demos/modern-research'
T='/tmp/mr_'
def run(*a): subprocess.run(list(a),check=True)
def rms(y): return np.sqrt(np.mean(y[np.abs(y)>1e-4]**2))
def level(y,db=-21,peak=0.89):
    y=y*(10**(db/20)/rms(y)); m=np.max(np.abs(y))
    return y if m<=peak else np.tanh(y/peak)*peak
def bp(y,lo,hi,o=4):
    sos=signal.butter(o,[lo,hi],'bandpass',fs=SR,output='sos'); return signal.sosfilt(sos,y)
def follower(y,att,rel):
    # vectorised-ish one-pole envelope via lfilter on rectified signal with asymmetric fallback
    a=np.exp(-1/(SR*att)); r=np.exp(-1/(SR*rel)); e=np.zeros_like(y); v=0.; ay=np.abs(y)
    for i in range(len(y)):
        c=ay[i]; v=a*v+(1-a)*c if c>v else r*v+(1-r)*c; e[i]=v
    return e
def hard_gate(y,thr_db=-38,hold=0.04):
    # digital radios go dead silent between words: gate with short hold, 3 ms ramps
    e=follower(y,0.002,0.03); on=(20*np.log10(e+1e-9)>thr_db+20*np.log10(np.max(np.abs(y)))).astype(float)
    h=int(SR*hold); on=np.convolve(on,np.ones(h),'same')>0
    ramp=np.ones(int(SR*0.003))/int(SR*0.003); return y*np.convolve(on.astype(float),ramp,'same')
def comp(y,thr_db=-24,ratio=4):
    e=follower(y,0.003,0.08)+1e-9; db=20*np.log10(e/np.max(np.abs(y))); over=np.maximum(db-thr_db,0)
    return y*10**(-over*(1-1/ratio)/20)
def codec2(mode,ber=None,tag='x'):
    run('ffmpeg','-y','-loglevel','error','-i',SRC,'-af','highpass=f=90','-ar','8000','-ac','1','-f','s16le',T+'in.raw')
    run('c2enc',mode,T+'in.raw',T+tag+'.bit')
    args=['c2dec',mode,T+tag+'.bit',T+tag+'.raw']+(['--ber',str(ber)] if ber else [])
    subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    run('ffmpeg','-y','-loglevel','error','-f','s16le','-ar','8000','-ac','1','-i',T+tag+'.raw','-ar',str(SR),T+tag+'.wav')
    return wavfile.read(T+tag+'.wav')[1]/32768.
def finish(y,lo,hi,clip):
    y=bp(y,lo,hi); y=hard_gate(y); y=comp(y); y=y/np.max(np.abs(y))
    y=np.clip(y*clip,-1,1)/clip if clip>1 else y      # light digital clipping on peaks
    return level(y)
V={}
V['01-codec2-3200-dmr-clean']=finish(codec2('3200',tag='a'),300,3400,1.4)
V['02-codec2-1300-buzzy']=finish(codec2('1300',tag='b'),300,3200,1.6)
V['03-codec2-700c-military-lowrate']=finish(codec2('700C',tag='c'),300,3000,1.6)
V['04-codec2-1300-weak-signal']=finish(codec2('1300',ber=0.015,tag='d'),300,3200,1.6)
for k,y in V.items():
    wavfile.write(T+k+'.wav',SR,(y*32767).astype(np.int16))
    run('ffmpeg','-y','-loglevel','error','-i',T+k+'.wav','-codec:a','libmp3lame','-b:a','128k',f'{OUT}/{k}.mp3')
    print(k, round(20*np.log10(rms(y)),1),'dB rms', round(20*np.log10(np.max(np.abs(y))),1),'dB peak')
def spoken(txt):
    w=T+'lab.wav'; run('espeak-ng','-v','en-us+m3','-s','160','-w',w,txt)
    run('ffmpeg','-y','-loglevel','error','-i',w,'-ar',str(SR),'-ac','1',T+'lab48.wav')
    m=wavfile.read(T+'lab48.wav')[1]/32768.; return m/np.max(np.abs(m))*0.35
sil=lambda s: np.zeros(int(SR*s))
clean=level(wavfile.read(SRC)[1]/32768.)
labels=[('Number 1. Codec 2, 3200. Clean digital.','01-codec2-3200-dmr-clean'),('Number 2. Codec 2, 1300. Buzzy.','02-codec2-1300-buzzy'),
 ('Number 3. Codec 2, 700. Low rate military.','03-codec2-700c-military-lowrate'),('Number 4. Codec 2, 1300. Weak signal.','04-codec2-1300-weak-signal')]
parts=[spoken('Reference. Original voice, no filter.'),sil(0.4),clean,sil(0.8)]
for l,k in labels: parts+=[spoken(l),sil(0.4),V[k],sil(0.8)]
y=np.clip(np.concatenate(parts),-1,1); wavfile.write(T+'all.wav',SR,(y*32767).astype(np.int16))
run('ffmpeg','-y','-loglevel','error','-i',T+'all.wav','-codec:a','libmp3lame','-b:a','128k',f'{OUT}/00-modern.mp3')
print('total',round(len(y)/SR,1),'s')
