// Streaming linear-interpolation resampler with cross-block history.
// Downsamples 44.1/48 kHz mono audio to 16 kHz mono for transient analysis.

export class StreamingResampler {
  private readonly ratio: number;
  private inputBuffer: number[] = [];
  /** Fractional input position (in global input samples) of the next output. */
  private t = 0;

  constructor(inputRate: number, outputRate = 16000) {
    if (inputRate <= 0 || outputRate <= 0) {
      throw new Error("Resampler rates must be positive");
    }
    this.ratio = inputRate / outputRate;
  }

  /**
   * Push a block of input samples (mono, input rate) and receive resampled
   * output samples. State (including the fractional phase and leftover input
   * sample) is carried across calls so block boundaries are seamless.
   */
  process(input: Float32Array | number[]): Float32Array {
    for (let i = 0; i < input.length; i++) {
      this.inputBuffer.push(input[i]);
    }

    const out: number[] = [];
    while (Math.floor(this.t) + 1 < this.inputBuffer.length) {
      const i = Math.floor(this.t);
      const frac = this.t - i;
      const s0 = this.inputBuffer[i];
      const s1 = this.inputBuffer[i + 1];
      out.push(s0 + (s1 - s0) * frac);
      this.t += this.ratio;
    }

    const consumed = Math.min(Math.floor(this.t), this.inputBuffer.length);
    if (consumed > 0) {
      this.inputBuffer.splice(0, consumed);
      this.t -= consumed;
    }

    return Float32Array.from(out);
  }

  reset() {
    this.inputBuffer = [];
    this.t = 0;
  }
}
