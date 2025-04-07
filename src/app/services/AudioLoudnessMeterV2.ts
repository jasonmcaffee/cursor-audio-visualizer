/**
 * AudioLoudnessMeterV2 - Improved version of AudioLoudnessMeter
 * 
 * Functionality:
 * - Monitors audio input for loudness threshold crossing
 * - Provides pre-trigger buffer audio when threshold is crossed
 * - Detects silence after loudness events
 * - Maintains a single MediaRecorder instance throughout lifecycle
 * - Provides periodic volume information
 * - Ensures audio blobs are properly formatted with headers
 */

interface AudioLoudnessMeterConfig {
  loudnessThreshold: number;           // Default loudness threshold (0-100)
  silenceDuration: number;            // Duration of silence before callback (ms)
  initialRecordingDuration: number;   // Initial audio recording duration after trigger (ms)
  preTriggerBufferDuration: number;   // Audio to keep before trigger (ms)
  volumeCheckInterval: number;        // Interval for volume checking (ms)
  fftSize: number;                    // FFT size for analysis
  currentMimeType: string;            // MIME type for audio recording
  echoCancellation: boolean;          // Enable echo cancellation
  noiseSuppression: boolean;          // Enable noise suppression
  autoGainControl: boolean;           // Enable auto gain control
  mediaStreamTimeSlice: number;       // Time slice for MediaRecorder
}

interface AudioLoudnessMeterCallbacks {
  onAudioAboveThresholdDetected?: (audioBlob: Blob) => void;
  onPeriodicVolumeInformation?: (volume: number) => void;
  onSilenceDetected?: (completeAudioBlob: Blob) => void;
}

class AudioLoudnessMeterV2 {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  
  // Recording state
  private isAnalyzing: boolean = false;
  private isRecording: boolean = false;
  private isInLoudnessEvent: boolean = false;
  private audioStartPoint: number = 0;
  
  // Audio storage
  private audioChunks: Blob[] = [];
  private headerChunks: Blob[] = [];
  private lastChunkTimestamp: number = 0;
  private hasCapturedHeaders: boolean = false;
  private chunkTimestamps: number[] = []; // Track timestamps for each chunk
  
  // Timers and timestamps
  private volumeInterval: number | null = null;
  private silenceTimeout: number | null = null;
  private lastLoudnessTime: number = 0;
  
  // Callbacks
  private callbacks: AudioLoudnessMeterCallbacks = {};

  // Configuration with defaults
  private config: AudioLoudnessMeterConfig = {
    loudnessThreshold: 10,
    silenceDuration: 1000,
    initialRecordingDuration: 1000,
    preTriggerBufferDuration: 20,
    volumeCheckInterval: 50,
    fftSize: 1024,
    currentMimeType: 'audio/webm;codecs=opus',
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    mediaStreamTimeSlice: 50,
  };

  constructor(config?: Partial<AudioLoudnessMeterConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  public async start(callbacks: AudioLoudnessMeterCallbacks = {}): Promise<void> {
    if (this.isAnalyzing) {
      console.warn('AudioLoudnessMeterV2 is already running');
      return;
    }

    this.callbacks = callbacks;

    try {
      await this.initializeAudioContext();
      await this.initializeMediaStream();
      this.setupAudioAnalysis();
      this.startContinuousRecording();
      this.isAnalyzing = true;
    } catch (error) {
      console.error('Error starting AudioLoudnessMeterV2:', error);
      await this.cleanup();
      throw error;
    }
  }

  public stop(): void {
    if (!this.isAnalyzing) return;
    
    this.cleanupTimers();
    this.stopRecording();
    this.cleanupAudioResources();
    this.resetState();
  }

  private async initializeAudioContext(): Promise<void> {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    await this.audioContext.resume();
  }

  private async initializeMediaStream(): Promise<void> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: this.config.echoCancellation,
        noiseSuppression: this.config.noiseSuppression,
        autoGainControl: this.config.autoGainControl,
      }
    });
  }

  private setupAudioAnalysis(): void {
    if (!this.audioContext || !this.mediaStream) {
      throw new Error('Audio context or media stream not initialized');
    }

    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = this.config.fftSize;
    this.analyser.smoothingTimeConstant = 0.3;
    this.source.connect(this.analyser);

    this.startVolumeChecking();
  }

  private startVolumeChecking(): void {
    const bufferLength = this.analyser!.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let lastLoudnessOverThreshold = false;
    let silenceStartTime: number | null = null;

    this.volumeInterval = window.setInterval(() => {
      if (!this.analyser) return;

      this.analyser.getByteFrequencyData(dataArray);
      const averageLoudness = this.calculateAverageLoudness(dataArray);
      const normalizedLoudness = (averageLoudness / 255) * 100;

      this.callbacks.onPeriodicVolumeInformation?.(normalizedLoudness);

      const isLoudnessOverThreshold = normalizedLoudness >= this.config.loudnessThreshold;

      if (isLoudnessOverThreshold && !lastLoudnessOverThreshold) {
        this.handleLoudnessDetected();
        silenceStartTime = null;
      }

      if (!isLoudnessOverThreshold && lastLoudnessOverThreshold) {
        silenceStartTime = Date.now();
      } else if (!isLoudnessOverThreshold && silenceStartTime !== null) {
        const silenceDuration = Date.now() - silenceStartTime;
        if (silenceDuration >= this.config.silenceDuration) {
          this.handleSilenceDetected();
          silenceStartTime = null;
        }
      }

      lastLoudnessOverThreshold = isLoudnessOverThreshold;
    }, this.config.volumeCheckInterval);
  }

  private calculateAverageLoudness(dataArray: Uint8Array): number {
    return dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
  }

  private handleLoudnessDetected(): void {
    if (this.isInLoudnessEvent) return;

    this.audioStartPoint = Date.now() - this.config.preTriggerBufferDuration;
    this.isInLoudnessEvent = true;

    // Instead of using setTimeout, we'll check periodically if we have enough audio
    const checkInterval = setInterval(() => {
      if (!this.isRecording) {
        clearInterval(checkInterval);
        return;
      }

      // Calculate the target end time
      const targetEndTime = this.audioStartPoint + this.config.initialRecordingDuration;
      
      // Check if we have chunks that cover the full duration
      const hasEnoughAudio = this.chunkTimestamps.some(timestamp => 
        timestamp >= targetEndTime
      );

      if (hasEnoughAudio) {
        clearInterval(checkInterval);
        this.sendInitialBlob();
      }
    }, this.config.mediaStreamTimeSlice);
  }

  private handleSilenceDetected(): void {
    if (!this.isInLoudnessEvent) return;

    this.sendCompleteBlob();
    this.stopRecording();
    this.isInLoudnessEvent = false;
    this.startContinuousRecording();
  }

  private startContinuousRecording(): void {
    if (!this.mediaStream) return;

    this.mediaRecorder = new MediaRecorder(this.mediaStream, {
      mimeType: this.config.currentMimeType,
      audioBitsPerSecond: 128000,
    });

    this.audioChunks = [];
    this.chunkTimestamps = [];
    if (!this.hasCapturedHeaders) {
      this.headerChunks = [];
    }

    this.isRecording = true;
    this.lastChunkTimestamp = Date.now();

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        if (!this.hasCapturedHeaders && this.headerChunks.length < 2) {
          this.headerChunks.push(event.data);
          if (this.headerChunks.length >= 2) {
            this.hasCapturedHeaders = true;
          }
        }
        this.audioChunks.push(event.data);
        this.chunkTimestamps.push(Date.now());
        this.lastChunkTimestamp = Date.now();
      }
    };

    this.mediaRecorder.start(this.config.mediaStreamTimeSlice);
  }

  private stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.isRecording = false;
  }

  private sendInitialBlob(): void {
    if (!this.isRecording || this.audioChunks.length === 0) return;

    const endTime = this.audioStartPoint + this.config.initialRecordingDuration;
    const relevantChunks = this.getRelevantChunks(this.audioStartPoint, endTime);

    if (relevantChunks.length > 0) {
      const initialBlob = new Blob([...this.headerChunks, ...relevantChunks], {
        type: this.config.currentMimeType,
      });
      this.callbacks.onAudioAboveThresholdDetected?.(initialBlob);
    }
  }

  private sendCompleteBlob(): void {
    if (!this.isRecording || this.audioChunks.length === 0) return;

    const relevantChunks = this.getRelevantChunks(this.audioStartPoint, Date.now());

    if (relevantChunks.length > 0) {
      const completeBlob = new Blob([...this.headerChunks, ...relevantChunks], {
        type: this.config.currentMimeType,
      });
      this.callbacks.onSilenceDetected?.(completeBlob);
    }
  }

  private getRelevantChunks(startTime: number, endTime: number): Blob[] {
    return this.audioChunks.filter((_, index) => {
      const chunkTime = this.chunkTimestamps[index];
      return chunkTime >= startTime && chunkTime <= endTime;
    });
  }

  private cleanupTimers(): void {
    if (this.volumeInterval !== null) {
      clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }
    if (this.silenceTimeout !== null) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
  }

  private cleanupAudioResources(): void {
    this.source?.disconnect();
    this.source = null;
    this.analyser?.disconnect();
    this.analyser = null;
    this.mediaStream?.getTracks().forEach(track => track.stop());
    this.mediaStream = null;
    this.audioContext?.close();
    this.audioContext = null;
  }

  private resetState(): void {
    this.isAnalyzing = false;
    this.isRecording = false;
    this.isInLoudnessEvent = false;
    this.audioStartPoint = 0;
    this.audioChunks = [];
    this.chunkTimestamps = [];
    this.headerChunks = [];
    this.lastChunkTimestamp = 0;
    this.hasCapturedHeaders = false;
    this.lastLoudnessTime = 0;
    this.callbacks = {};
  }

  private async cleanup(): Promise<void> {
    this.cleanupTimers();
    this.stopRecording();
    this.cleanupAudioResources();
    this.resetState();
  }
}

export default AudioLoudnessMeterV2; 