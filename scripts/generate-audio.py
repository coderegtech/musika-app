"""Generate three original 24-second ambient loops. No third-party recordings."""
import math
import struct
import wave
from pathlib import Path
Path('assets').mkdir(exist_ok=True)
for variation in range(3):
    rate=22050
    notes=[220,261.63,329.63,392] if variation==0 else ([196,246.94,293.66,369.99] if variation==1 else [174.61,220,261.63,349.23])
    with wave.open(f'assets/demo-{variation}.wav','wb') as f:
        f.setparams((1,2,rate,0,'NONE','not compressed'))
        frames=bytearray()
        for i in range(rate*24):
            t=i/rate; pulse=t%0.5; n=notes[int(t*2)%4]; fade=min(1,t/1.5,(24-t)/2)
            pad=sum(math.sin(2*math.pi*h*t)*.055 for h in notes)
            bell=(math.sin(2*math.pi*n*2*t)+.3*math.sin(2*math.pi*n*4*t))*.16*math.exp(-pulse*8)
            bass=math.sin(2*math.pi*notes[int(t/6)%4]/2*t)*.10
            frames.extend(struct.pack('<h',int((pad+bell+bass)*fade*24000)))
        f.writeframes(frames)
