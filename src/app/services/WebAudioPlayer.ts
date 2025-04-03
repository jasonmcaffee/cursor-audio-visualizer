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
      // Stop any currently playing audio
      this.stop();

      // Ensure the file path starts with a forward slash
      const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
      
      // Fetch the audio file
      const response = await fetch(normalizedPath);
      if (!response.ok) {
        throw new Error(`Failed to fetch audio file: ${response.status} ${response.statusText}`);
      }
      
      const audioBlob = await response.blob();
      if (audioBlob.size === 0) {
        throw new Error('Audio file is empty');
      }
      
      // Try to play the audio blob directly first
      try {
        await this.playAudioBlob(audioBlob);
      } catch (error) {
        console.error('Error playing audio file directly:', error);
        // If direct playback fails, try converting the format
        const convertedBlob = await this.convertAudioFormat(audioBlob);
        await this.playAudioBlob(convertedBlob);
      }
    } catch (error) {
      console.error('Error playing audio file:', error);
      throw error;
    }
  }

  async playAudioBlob(audioBlob: Blob): Promise<void> {
    try {
      // Stop any currently playing audio
      this.stop();

      // Convert blob to array buffer
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      // Try to decode the audio data
      try {
        this.audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
      } catch (decodeError) {
        console.error('Error decoding audio data:', decodeError);
        // Try to convert the audio format if needed
        const convertedBlob = await this.convertAudioFormat(audioBlob);
        const convertedArrayBuffer = await convertedBlob.arrayBuffer();
        this.audioBuffer = await this.audioContext!.decodeAudioData(convertedArrayBuffer);
      }
      
      // Create and configure the source
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

  private async convertAudioFormat(audioBlob: Blob): Promise<Blob> {
    // Create a temporary audio element to convert the format
    const audio = new Audio() as HTMLAudioElement & { captureStream: () => MediaStream };
    const objectUrl = URL.createObjectURL(audioBlob);
    audio.src = objectUrl;

    return new Promise((resolve, reject) => {
      audio.oncanplaythrough = async () => {
        try {
          // Create a MediaRecorder to capture the converted audio
          const mediaStream = audio.captureStream();
          const recorder = new MediaRecorder(mediaStream, {
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 128000,
          });

          const chunks: Blob[] = [];
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunks.push(event.data);
            }
          };

          recorder.onstop = () => {
            const convertedBlob = new Blob(chunks, { type: 'audio/webm;codecs=opus' });
            URL.revokeObjectURL(objectUrl);
            resolve(convertedBlob);
          };

          // Start recording and play the audio
          recorder.start();
          await audio.play();

          // Stop recording after the audio finishes playing
          audio.onended = () => {
            recorder.stop();
          };
        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          reject(error);
        }
      };

      audio.onerror = (error) => {
        URL.revokeObjectURL(objectUrl);
        reject(error);
      };
    });
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