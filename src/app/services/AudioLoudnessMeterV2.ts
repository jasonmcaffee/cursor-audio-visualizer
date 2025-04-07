/**
 * AudioLoudnessMeterV2 - Monitors audio input for loudness threshold crossing and silence detection
 * 
 * Detailed Requirements:
 * 
 * 1. Loudness Detection:
 *    - When audio volume crosses above the loudnessThreshold, trigger loudness detection
 *    - The audio blob sent to onAudioAboveThresholdDetected must:
 *      a. Start preTriggerBufferDuration before the threshold was crossed
 *      b. Be EXACTLY initialRecordingDuration long (no more, no less)
 *      c. Include all audio from the start point to the end point
 *      d. If not enough audio is available yet, wait until we have exactly initialRecordingDuration of audio
 *    Example: If "one two three" is spoken and "two" crosses the threshold:
 *      - Start point = time when "one" started (preTriggerBufferDuration before threshold)
 *      - End point = start point + initialRecordingDuration (exactly)
 *      - Audio blob should contain exactly initialRecordingDuration of audio
 * 
 * 2. Silence Detection:
 *    - After loudness is detected, monitor for silence
 *    - Silence is defined as volume staying below threshold for silenceDuration
 *    - When silence is detected, the audio blob sent to onSilenceDetected must:
 *      a. Start at the same point as the loudness detection blob (preTriggerBufferDuration before threshold)
 *      b. Include all audio up until silence was detected
 *    Example: If "one two three" is spoken and then silence:
 *      - Start point = time when "one" started (same as loudness detection)
 *      - End point = time when silence was detected
 *      - Audio blob should contain "one two three"
 * 
 * 3. Continuous Monitoring:
 *    - Volume must be monitored continuously via onPeriodicVolumeInformation
 *    - Only one loudness event can be active at a time
 *    - New loudness events cannot start until silence is detected from the previous event
 * 
 * 4. Audio Quality:
 *    - All audio blobs must include proper headers for the specified mimeType
 *    - Audio must be playable by standard web audio players
 *    - No audio should be lost or clipped between loudness and silence detection
 */

interface AudioLoudnessMeterConfig {
  loudnessThreshold: number;           // Volume level (0-100) that triggers loudness detection
  silenceDuration: number;            // Duration of silence (ms) before triggering silence detection
  initialRecordingDuration: number;   // Length (ms) of audio blob sent on loudness detection
  preTriggerBufferDuration: number;   // Audio (ms) to keep before loudness threshold crossing
  volumeCheckInterval: number;        // How often (ms) to check volume level
  fftSize: number;                    // FFT size for frequency analysis
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
  private audioStartPoint: number = 0;  // Timestamp when audio started (preTriggerBufferDuration before threshold)
  private hasSentInitialBlob: boolean = false;
  
  // Audio storage
  private audioChunks: Blob[] = [];
  private headerChunks: Blob[] = [];
  private lastChunkTimestamp: number = 0;
  private hasCapturedHeaders: boolean = false;
  private chunkTimestamps: { start: number; end: number }[] = []; // Track timestamps for each chunk
  
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
        // Start timing silence when loudness drops below threshold
        silenceStartTime = Date.now();
      } else if (!isLoudnessOverThreshold && silenceStartTime !== null) {
        // Check if we've been silent for long enough
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

    // Set the audio start point to preTriggerBufferDuration before current time
    this.audioStartPoint = Date.now() - this.config.preTriggerBufferDuration;
    this.isInLoudnessEvent = true;
    this.hasSentInitialBlob = false;

    // Check periodically if we have enough audio
    const checkInterval = setInterval(() => {
      if (!this.isRecording) {
        clearInterval(checkInterval);
        return;
      }

      // Calculate the target end time
      const targetEndTime = this.audioStartPoint + this.config.initialRecordingDuration;
      const currentTime = Date.now();
      
      // If we have enough audio, send the initial blob
      if (currentTime >= targetEndTime) {
        clearInterval(checkInterval);
        this.sendInitialBlob();
      }
    }, this.config.mediaStreamTimeSlice);
  }

  private handleSilenceDetected(): void {
    if (!this.isInLoudnessEvent) return;

    this.sendCompleteBlob();
    this.isInLoudnessEvent = false;
    this.hasSentInitialBlob = false;
    
    // Clear all chunks after silence is detected
    this.audioChunks = [];
    this.chunkTimestamps = [];
  }

  private startContinuousRecording(): void {
    if (!this.mediaStream) return;

    this.mediaRecorder = new MediaRecorder(this.mediaStream, {
      mimeType: this.config.currentMimeType,
      audioBitsPerSecond: 128000,
    });

    // Only clear chunks if we're not in a loudness event
    if (!this.isInLoudnessEvent) {
      this.audioChunks = [];
      this.chunkTimestamps = [];
    }
    
    if (!this.hasCapturedHeaders) {
      this.headerChunks = [];
    }

    this.isRecording = true;
    this.lastChunkTimestamp = Date.now();

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        const currentTime = Date.now();
        
        if (!this.hasCapturedHeaders && this.headerChunks.length < 2) {
          this.headerChunks.push(event.data);
          if (this.headerChunks.length >= 2) {
            this.hasCapturedHeaders = true;
          }
        }
        
        // Store the chunk with its start time (lastChunkTimestamp) and end time (currentTime)
        this.audioChunks.push(event.data);
        this.chunkTimestamps.push({
          start: this.lastChunkTimestamp,
          end: currentTime
        });
        this.lastChunkTimestamp = currentTime;
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

  private getRelevantChunks(startTime: number, endTime: number, isSilenceDetection: boolean = false): Blob[] {
    const relevantChunks: Blob[] = [];
    let totalDuration = 0;
    let firstChunkIndex = -1;
    let lastChunkIndex = -1;

    // First pass: find the chunks that overlap with our time window
    for (let i = 0; i < this.audioChunks.length; i++) {
      const chunkTime = this.chunkTimestamps[i];
      
      // If chunk overlaps with our time window, include it
      if (chunkTime.start < endTime && chunkTime.end > startTime) {
        if (firstChunkIndex === -1) firstChunkIndex = i;
        lastChunkIndex = i;
        relevantChunks.push(this.audioChunks[i]);
        totalDuration += chunkTime.end - chunkTime.start;
      }
    }

    // If we don't have enough chunks to make up the full duration, return empty
    if (relevantChunks.length === 0 || (!isSilenceDetection && totalDuration < this.config.initialRecordingDuration)) {
      console.log(`Not enough audio chunks: ${totalDuration}ms vs required ${this.config.initialRecordingDuration}ms`);
      return [];
    }

    // For silence detection, return all relevant chunks without trimming
    if (isSilenceDetection) {
      return relevantChunks;
    }

    // Calculate the exact duration we need for initial blob
    const targetEndTime = startTime + this.config.initialRecordingDuration;
    const trimmedChunks: Blob[] = [];
    let currentDuration = 0;

    // Second pass: trim to exactly initialRecordingDuration
    for (let i = firstChunkIndex; i <= lastChunkIndex; i++) {
      const chunkTime = this.chunkTimestamps[i];
      const chunkStart = Math.max(chunkTime.start, startTime);
      const chunkEnd = Math.min(chunkTime.end, targetEndTime);
      const chunkDuration = chunkEnd - chunkStart;

      if (chunkDuration > 0) {
        trimmedChunks.push(this.audioChunks[i]);
        currentDuration += chunkDuration;
      }

      // Stop if we've reached our target duration
      if (currentDuration >= this.config.initialRecordingDuration) {
        break;
      }
    }

    // Log the trimming details
    if (totalDuration !== currentDuration) {
      console.log(`Trimmed audio from ${totalDuration}ms to ${currentDuration}ms (target: ${this.config.initialRecordingDuration}ms)`);
    }

    return trimmedChunks;
  }

  private sendInitialBlob(): void {
    if (this.audioChunks.length === 0) return;

    const endTime = this.audioStartPoint + this.config.initialRecordingDuration;
    const relevantChunks = this.getRelevantChunks(this.audioStartPoint, endTime, false);

    if (relevantChunks.length > 0) {
      // Calculate the actual duration of the chunks we're about to send
      const firstChunkTime = this.chunkTimestamps[0].start;
      const lastChunkTime = this.chunkTimestamps[relevantChunks.length - 1].end;
      const actualDuration = lastChunkTime - firstChunkTime;
      
      console.log(`[Initial Blob] Duration: ${actualDuration}ms (target: ${this.config.initialRecordingDuration}ms)`);

      const initialBlob = new Blob([...this.headerChunks, ...relevantChunks], {
        type: this.config.currentMimeType,
      });
      this.callbacks.onAudioAboveThresholdDetected?.(initialBlob);
      this.hasSentInitialBlob = true;
    }
  }

  private sendCompleteBlob(): void {
    if (this.audioChunks.length === 0) return;

    const relevantChunks = this.getRelevantChunks(this.audioStartPoint, Date.now(), true);

    if (relevantChunks.length > 0) {
      // Calculate the actual duration of the complete blob
      const firstChunkTime = this.chunkTimestamps[0].start;
      const lastChunkTime = this.chunkTimestamps[relevantChunks.length - 1].end;
      const actualDuration = lastChunkTime - firstChunkTime;
      
      console.log(`[Complete Blob] Duration: ${actualDuration}ms`);

      const completeBlob = new Blob([...this.headerChunks, ...relevantChunks], {
        type: this.config.currentMimeType,
      });
      this.callbacks.onSilenceDetected?.(completeBlob);
    }
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
    this.hasSentInitialBlob = false;
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