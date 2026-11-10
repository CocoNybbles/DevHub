/**
 * Mikrofonaufnahme als WAV (16 kHz, mono, 16 bit) – das Format, das whisper.cpp erwartet.
 * Chromium resampelt automatisch, wenn der AudioContext mit 16 kHz erzeugt wird.
 */
export class Recorder {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private proc: ScriptProcessorNode | null = null
  private chunks: Float32Array[] = []
  private static readonly RATE = 16000

  async start(): Promise<void> {
    this.chunks = []
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    })
    this.ctx = new AudioContext({ sampleRate: Recorder.RATE })
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1)
    this.proc.onaudioprocess = (e) => {
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    }
    source.connect(this.proc)
    this.proc.connect(this.ctx.destination)
  }

  /** Beendet die Aufnahme und liefert die WAV-Daten (oder null bei < 0,3 s). */
  async stop(): Promise<ArrayBuffer | null> {
    const samples = this.release()
    await this.ctx?.close()
    this.ctx = null
    if (samples.length < Recorder.RATE * 0.3) return null
    return encodeWav(samples, Recorder.RATE)
  }

  cancel(): void {
    this.release()
    this.ctx?.close()
    this.ctx = null
  }

  private release(): Float32Array {
    this.proc?.disconnect()
    this.proc = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    const total = this.chunks.reduce((n, c) => n + c.length, 0)
    const out = new Float32Array(total)
    let offset = 0
    for (const c of this.chunks) {
      out.set(c, offset)
      offset += c.length
    }
    this.chunks = []
    return out
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buffer)
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true) // Chunk-Größe
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // Byte-Rate
  v.setUint16(32, 2, true) // Block-Align
  v.setUint16(34, 16, true) // Bits pro Sample
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}
