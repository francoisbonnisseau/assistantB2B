/**
 * AudioWorklet processor that extracts raw PCM Float32 samples
 * and posts them back to the main thread.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._chunkCount = 0
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    if (!input || !input.length) return true

    // Pick the channel with highest energy to avoid phase-cancellation
    // when channels are opposite-polarity on some meeting/tab pipelines.
    const channelCount = input.length
    const frameCount = input[0].length
    const mono = new Float32Array(frameCount)

    let selectedChannel = 0
    let bestEnergy = -1

    for (let ch = 0; ch < channelCount; ch++) {
      let energy = 0
      const channel = input[ch]
      for (let i = 0; i < frameCount; i++) {
        const sample = channel[i]
        energy += sample * sample
      }
      if (energy > bestEnergy) {
        bestEnergy = energy
        selectedChannel = ch
      }
    }

    const selected = input[selectedChannel]
    for (let i = 0; i < frameCount; i++) {
      mono[i] = selected[i]
    }

    // Post the Float32 samples to the main thread
    this.port.postMessage({ samples: mono, sampleRate: sampleRate })

    return true
  }
}

registerProcessor('pcm-processor', PCMProcessor)
