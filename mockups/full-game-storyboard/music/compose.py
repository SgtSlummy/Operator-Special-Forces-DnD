"""Deterministic original score. Synthesizes every instrument; no sample libraries.
Run: python music/compose.py (requires numpy and ffmpeg on PATH).
"""
from pathlib import Path
import numpy as np
import json, wave, subprocess, hashlib

ROOT = Path(__file__).resolve().parent
SR = 32000
RNG = np.random.default_rng(90626)
TRACKS = [
    ('theme', 'Crossing the Veil', 84, 'A recurring flute motif, glass bells and swelling strings. Mystery opens into wonder.'),
    ('exploration', 'Saltglass & Starlight', 76, 'Plucked strings, breathy woodwind and a slow sea of harmony for discovery.'),
    ('tension', 'Lanterns in the Mist', 96, 'Low pulses, ticking percussion and suspended strings as the patrol passes.'),
    ('drama', 'One Life Against the Tide', 88, 'Rising strings, deep drums and the Veil motif for the courier rescue.'),
    ('battle', 'Break the Iron Night', 132, 'Synthesized distorted power chords, driving bass, drums and a soaring lead.'),
    ('sanctuary', 'The Abbey Keeps a Light', 72, 'Warm string voicings, a gentle harp and bells for shelter and conversation.'),
    ('aftermath', 'What We Carry Home', 78, 'A quieter reprise on soft keys and strings for reflection and the episode recap.'),
]

def tone(note, seconds, kind):
    t = np.arange(int(seconds * SR), dtype=np.float64) / SR
    f = 440 * 2 ** ((note - 69) / 12)
    phase = 2*np.pi*f*t
    if kind == 'strings':
        y = sum(np.sin(phase*k + .012*k*np.sin(2*np.pi*4.8*t))/k**1.7 for k in range(1,7))
        y += .18*np.sin(phase*1.002)
        env = (1-np.exp(-t/0.32))*np.minimum(1, np.maximum(0,seconds-t)/.65)
    elif kind == 'flute':
        p = phase + .016*np.sin(2*np.pi*5.1*t)
        y = np.sin(p)+.17*np.sin(2*p)+.055*np.sin(3*p)
        env = (1-np.exp(-t/.065))*np.exp(-t/(seconds*2))*np.minimum(1,(seconds-t)/.18)
    elif kind in ('harp','keys','bell'):
        if kind == 'bell':
            y = np.sin(phase)*np.exp(-t/1.5)+.3*np.sin(phase*2.76)*np.exp(-t/.7)+.16*np.sin(phase*5.4)*np.exp(-t/.25)
        else:
            y = sum(np.sin(phase*k)*np.exp(-t*(1.3+k*.32))/k**1.8 for k in range(1,8))
        env = (1-np.exp(-t/.006))*np.minimum(1,(seconds-t)/.12)
    elif kind == 'guitar':
        y = sum(np.sin(phase*k)/k for k in range(1,13))
        y = np.tanh(y*2.3)*.65 + .13*np.sin(phase*1.004)
        env = (1-np.exp(-t/.004))*np.exp(-t*2.1)*np.minimum(1,(seconds-t)/.05)
    elif kind == 'bass':
        y = np.sin(phase)+.22*np.sin(2*phase)+.09*np.sin(3*phase)
        env = (1-np.exp(-t/.012))*np.exp(-t*.6)*np.minimum(1,(seconds-t)/.08)
    elif kind == 'kick':
        y = np.sin(2*np.pi*(46*t+7*(1-np.exp(-t*30))))*np.exp(-t*11)
        env = np.minimum(1,t/.002)
    elif kind == 'snare':
        noise = RNG.normal(0,1,len(t)); noise -= np.roll(noise,1)*.7
        y = .35*noise*np.exp(-t*19)+.4*np.sin(2*np.pi*180*t)*np.exp(-t*27)
        env = np.minimum(1,t/.002)
    elif kind == 'hat':
        noise = RNG.normal(0,1,len(t)); y = (noise-np.roll(noise,1))*.19*np.exp(-t*45)
        env = np.minimum(1,t/.001)
    elif kind == 'drum':
        y = np.sin(2*np.pi*(65*t+2*(1-np.exp(-t*15))))*np.exp(-t*4)+.08*RNG.normal(0,1,len(t))*np.exp(-t*12)
        env = np.minimum(1,t/.003)
    return (y*env).astype(np.float32)

def compose(key, bpm):
    beat = 60/bpm; bars=24; length=int(bars*4*beat*SR)
    mix=np.zeros((length,2),np.float32)
    def put(note, b, duration, kind, gain=.15, pan=0):
        samples=tone(note,duration*beat,kind)*gain
        start=int(b*beat*SR)
        indices=(start+np.arange(len(samples)))%length
        np.add.at(mix[:,0],indices,samples*np.sqrt((1-pan)/2))
        np.add.at(mix[:,1],indices,samples*np.sqrt((1+pan)/2))
    # D minor / modal colour; the theme's rising fifth recurs across the score.
    roots=[50,46,53,48,50,46,55,45]
    chords=[[62,65,69],[58,62,65],[60,65,69],[60,64,67],[62,65,69],[58,62,65],[59,62,67],[61,64,69]]
    motif=[[74,81,77,76],[74,72,69,65],[69,72,77,81],[79,76,72,69],
           [74,77,81,84],[82,81,77,74],[79,77,74,71],[73,76,81,69]]
    for bar in range(bars):
        c=bar%8; start=bar*4; section=bar//8
        warmth=key in ('sanctuary','aftermath'); energy=[.65,1,.82][section]
        chord=chords[c].copy(); root=roots[c]
        if key=='sanctuary' and c in (0,4): chord=[62,66,69,73]
        if key=='tension': chord=[50,57,64] if c%2==0 else [46,53,60]
        for j,n in enumerate(chord):
            put(n,start,5.1,'strings',(.045 if key=='battle' else .08)*energy,(j-1)*.42)
        put(root-12,start,3.9,'bass',.13*energy)
        if key not in ('tension','battle'):
            for j in range(8):
                n=chord[[0,1,2,1,0,2,1,2][j]%len(chord)]+(12 if j in (3,7) else 0)
                put(n,start+j*.5,2.5,'keys' if key=='aftermath' else 'harp',.105*energy,(-.45 if j%2 else .45))
        if key=='tension':
            for j in range(8):
                put(root-12+(12 if j%4==3 else 0),start+j*.5,.4,'bass',.14)
                put(0,start+j*.5,.3,'hat',.08, .4)
            if bar%2==0: put(0,start,2,'drum',.2)
            if bar%4==3: put(chord[-1]+12,start+2,3,'bell',.075,-.2)
        elif key=='battle':
            for j in range(8):
                for p in (-.7,.7):
                    for n in [root-12,root-5,root]: put(n,start+j*.5,.46 if j%4 else .7,'guitar',.09*energy,p)
                put(root-12,start+j*.5,.45,'bass',.15)
                put(0,start+j*.5,.3,'hat',.19 if j%2 else .24,.35)
            for j in (0,1.5,2,2.75): put(0,start+j,.8,'kick',.48)
            for j in (1,3): put(0,start+j,.6,'snare',.48,-.12)
            if bar%4==3:
                for j in (3.25,3.5,3.75):put(0,start+j,.3,'snare',.22)
        elif key in ('drama','theme'):
            if section>0 or key=='drama':
                for j in (0,2,3.5): put(0,start+j,1.7,'drum',.22*energy)
                for j in range(4): put(root,start+j,.7,'bass',.11*energy)
        # Leave breathing room, then answer the recurring phrase.
        if key!='tension' and (section>0 or bar%2==0):
            voice='keys' if key=='aftermath' else 'bell' if key=='sanctuary' else 'flute'
            for j,n in enumerate(motif[c]):
                put(n-(12 if warmth else 0),start+[0,1.5,2.5,3][j],[1.45,.95,.45,1.7][j],voice,.13 if key=='battle' else .11*energy,-.15)
        if key=='theme' and bar%4==0: put(86,start,6,'bell',.055,.6)
    # Circular stereo room returns preserve the loop seam, with no long silent tails.
    dry=mix.copy()
    for delay,level in ((.113,.13),(.229,.1),(.371,.075),(.557,.05),(.811,.035)):
        mix += np.roll(dry[:,::-1],int(delay*SR),axis=0)*level
    mix-=mix.mean(axis=0)
    mix=np.tanh(mix*.9)
    rms=float(np.sqrt(np.mean(mix**2))); peak=float(np.max(np.abs(mix)))
    mix*=min(.84/peak,.14/rms)
    return mix

manifest=[]
for key,title,bpm,description in TRACKS:
    music=compose(key,bpm)
    wav=ROOT/f'{key}.wav'; mp3=ROOT/f'{key}.mp3'
    with wave.open(str(wav),'wb') as f:
        f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR)
        f.writeframes((music*32767).astype('<i2').tobytes())
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','160k','-metadata',f'title={title}',str(mp3)],check=True)
    record=dict(id=key,title=title,bpm=bpm,description=description,seconds=round(len(music)/SR,3),bars=24,file=f'music/{key}.mp3',master=f'music/{key}.wav',peak=round(float(np.max(np.abs(music))),4),rms=round(float(np.sqrt(np.mean(music**2))),4),sha256=hashlib.sha256(mp3.read_bytes()).hexdigest())
    manifest.append(record); print(title,record['seconds'],flush=True)
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
