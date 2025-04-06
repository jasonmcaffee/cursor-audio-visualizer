class WebAudioPlayer {
  private audioContext: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;

  constructor() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
  }

  async playAudioFile(filePath: string): Promise<void> {
    try {
      this.stop();
      // Fetch the audio file
      const response = await fetch(filePath);
      const audioBlob = await response.blob();
      await this.playAudioBlob(audioBlob);
    } catch (error) {
      console.error('Error playing audio file:', error);
      throw error;
    }
  }

  async playAudioBlob(audioBlob: Blob): Promise<void> {
    console.log(`playing audio blob: `, audioBlob)
    try {
      this.stop();
      const arrayBuffer = await audioBlob.arrayBuffer();
      this.audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);

      this.source = this.audioContext!.createBufferSource();
      this.source.buffer = this.audioBuffer;
      
      // Connect the source to the gain node
      this.source.connect(this.gainNode!);
      
      // Start playing
      this.source.start(0);
    } catch (error) {
      console.error('Error playing audio:', error);
      throw error;
    }
  }


  stop(): void {
    if (this.source) {
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
  }

  setVolume(volume: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = volume;
    }
  }

  dispose(): void {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

export default WebAudioPlayer; 