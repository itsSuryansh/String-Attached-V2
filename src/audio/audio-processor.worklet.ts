// AudioWorklet processor for StringsAttached.
//
// This worklet captures the microphone input, downmixes it to mono, and
// resamples it to 16 kHz using a linear-interpolation resampler with
// cross-block history. The resampled PCM is posted to the main thread, where
// the deterministic transient detector (src/audio/downstroke.ts) runs.
//
// The audio path is ONLY used to detect acoustic transients associated with
// downstroke attempts. No pitch/chord recognition is performed.
//
// Ambient globals (AudioWorkletProcessor, registerProcessor, sampleRate) are
// declared in ./worklet-globals.d.ts.

const OUTPUT_RATE = 16000;

class DownsampleProcessor extends AudioWorkletProcessor {
  private ratio: number;
  private inputBuffer: number[] = [];
  private t = 0;
  private outputChunk: Float32Array;
  private outputFill = 0;

  constructor() {
    super();
    this.ratio = sampleRate / OUTPUT_RATE;
    // ~100 ms of 16 kHz PCM per chunk.
    this.outputChunk = new Float32Array(1600);
    this.port.onmessage = () => {
      /* main thread can send control messages; none required currently */
    };
  }

  private resample(block: Float32Array, out: number[]) {
    for (let i = 0; i < block.length; i++) {
      this.inputBuffer.push(block[i]);
    }
    while (Math.floor(this.t) + 1 < this.inputBuffer.length) {
      const i = Math.floor(this.t);
      const frac = this.t - i;
      const s0 = this.inputBuffer[i];
      const s1 = this.inputBuffer[i + 1];
      out.push(s0 + (s1 - s0) * frac);
      this.t += this.ratio;
    }
    const consumed = Math.floor(this.t);
    if (consumed > 0) {
      this.inputBuffer.splice(0, consumed);
      this.t -= consumed;
    }
  }

  process(
    inputs: Float32Array[][],
    _outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const input = inputs[0];
    if (!input || input.length === 0 || input[0].length === 0) {
      return true;
    }

    const mono = input[0];
    const out: number[] = [];
    this.resample(mono, out);

    for (let i = 0; i < out.length; i++) {
      if (this.outputFill >= this.outputChunk.length) {
        this.flush();
      }
      this.outputChunk[this.outputFill++] = out[i];
    }
    return true;
  }

  private flush() {
    const chunk = this.outputChunk.slice(0, this.outputFill);
    this.port.postMessage(
      { type: "pcm", data: chunk.buffer, sampleRate: OUTPUT_RATE },
      [chunk.buffer]
    );
    this.outputChunk = new Float32Array(1600);
    this.outputFill = 0;
  }
}

registerProcessor("downsample-processor", DownsampleProcessor);
