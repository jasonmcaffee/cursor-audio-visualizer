/**
 * A class to analyze audio input for loudness detection
 * Used for detecting spoken keywords like "Alexa" or "Siri"
 */
class AudioLoudnessMeter {
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private analyser: AnalyserNode | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private source: MediaStreamAudioSourceNode | null = null;
    private isRecording: boolean = false;
    private isAnalyzing: boolean = false;
    private recordedChunks: Blob[] = [];
    private silenceTimeout: number | null = null;
    private volumeInterval: number | null = null;
    private lastLoudnessTime: number = 0;
  
    // Callbacks
    private onAudioAboveThresholdDetected: ((audioBlob: Blob) => void) | null = null;
    private onPeriodicVolumeInformation: ((volume: number) => void) | null = null;
    private onSilenceDetected: (() => void) | null = null;
  
    // Configuration options with defaults
    private config = {
      loudnessThreshold: 5,          // Default loudness threshold (0-100)
      silenceDuration: 1000,          // Duration of silence before callback (ms)
      recordingDuration: 1000,        // Total audio recording duration (ms)
      preTriggerBufferDuration: 300,  // Audio to keep before trigger (ms)
      volumeCheckInterval: 50,        // Interval for volume checking (ms)
      fftSize: 1024,                  // FFT size for analysis
    };
  
    // Supported MIME types in order of preference
    private static readonly SUPPORTED_MIME_TYPES = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/wav',
    ];
  
    /**
     * Creates a new AudioLoudnessMeter
     * @param config Optional configuration parameters
     */
    constructor(config?: Partial<typeof AudioLoudnessMeter.prototype.config>) {
      if (config) {
        this.config = { ...this.config, ...config };
      }
    }
  
    /**
     * Get the supported MIME type for MediaRecorder
     */
    private getSupportedMimeType(): string | null {
      for (const mimeType of AudioLoudnessMeter.SUPPORTED_MIME_TYPES) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          return mimeType;
        }
      }
      return null;
    }
  
    /**
     * Start audio analysis and register callbacks
     */
    public async start(
      options: {
        onAudioAboveThresholdDetected?: (audioBlob: Blob) => void;
        onPeriodicVolumeInformation?: (volume: number) => void;
        onSilenceDetected?: () => void;
      } = {}
    ): Promise<void> {
      if (this.isAnalyzing) {
        console.warn('AudioLoudnessMeter is already running');
        return;
      }
  
      // Set callbacks
      this.onAudioAboveThresholdDetected = options.onAudioAboveThresholdDetected || null;
      this.onPeriodicVolumeInformation = options.onPeriodicVolumeInformation || null;
      this.onSilenceDetected = options.onSilenceDetected || null;
  
      try {
        // Initialize audio context and get media stream
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          } 
        });
        
        // Setup audio analysis
        this.setupAudioAnalysis();
        
        this.isAnalyzing = true;
      } catch (error) {
        console.error('Error starting AudioLoudnessMeter:', error);
        throw error;
      }
    }
  
    /**
     * Stop audio analysis and recording
     */
    public stop(): void {
      if (!this.isAnalyzing) {
        return;
      }
  
      // Clear intervals and timeouts
      if (this.volumeInterval !== null) {
        clearInterval(this.volumeInterval);
        this.volumeInterval = null;
      }
  
      if (this.silenceTimeout !== null) {
        clearTimeout(this.silenceTimeout);
        this.silenceTimeout = null;
      }
  
      // Stop recording if active
      this.stopRecording();
  
      // Clean up audio resources
      if (this.source) {
        this.source.disconnect();
        this.source = null;
      }
  
      if (this.analyser) {
        this.analyser.disconnect();
        this.analyser = null;
      }
  
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }
  
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }
  
      // Reset state
      this.isAnalyzing = false;
      this.recordedChunks = [];
      this.lastLoudnessTime = 0;
    }
  
    /**
     * Set up audio analysis nodes and start monitoring
     */
    private setupAudioAnalysis(): void {
      if (!this.audioContext || !this.mediaStream) {
        return;
      }
  
      // Create audio source from media stream
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      // Create analyzer
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.config.fftSize;
      this.analyser.smoothingTimeConstant = 0.3;
      
      // Connect source to analyzer
      this.source.connect(this.analyser);
      
      // Start periodic volume checking
      this.startVolumeChecking();
    }
  
    /**
     * Start the process of checking volume levels at regular intervals
     */
    private startVolumeChecking(): void {
      if (!this.analyser) {
        return;
      }
  
      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let lastLoudnessOverThreshold = false;
  
      this.volumeInterval = window.setInterval(() => {
        if (!this.analyser) return;
        
        // Get frequency data
        this.analyser.getByteFrequencyData(dataArray);
        
        // Calculate loudness (average of frequency data)
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const averageLoudness = sum / bufferLength;
        const normalizedLoudness = (averageLoudness / 255) * 100;
        
        // Call the periodic volume information callback
        if (this.onPeriodicVolumeInformation) {
          this.onPeriodicVolumeInformation(normalizedLoudness);
        }
        
        // Check if loudness crosses threshold
        const isLoudnessOverThreshold = normalizedLoudness >= this.config.loudnessThreshold;
        
        // Handle loudness detection
        if (isLoudnessOverThreshold && !lastLoudnessOverThreshold) {
          this.handleLoudnessDetected();
        } 
        
        // Handle silence detection
        if (!isLoudnessOverThreshold && lastLoudnessOverThreshold) {
          this.resetSilenceDetection();
        }
        
        lastLoudnessOverThreshold = isLoudnessOverThreshold;
      }, this.config.volumeCheckInterval);
    }
  
    /**
     * Handle when loudness above threshold is detected
     */
    private handleLoudnessDetected(): void {
      // Reset silence detection timeout
      if (this.silenceTimeout !== null) {
        clearTimeout(this.silenceTimeout);
        this.silenceTimeout = null;
      }
      
      // Start recording if not already recording
      if (!this.isRecording) {
        this.lastLoudnessTime = Date.now();
        this.startRecording();
      }
    }
  
    /**
     * Start recording audio
     */
    private startRecording(): void {
      if (!this.mediaStream) {
        return;
      }
  
      const mimeType = this.getSupportedMimeType();
      if (!mimeType) {
        console.error('No supported MIME type found for MediaRecorder');
        return;
      }
  
      this.mediaRecorder = new MediaRecorder(this.mediaStream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });
      
      this.recordedChunks = [];
      this.isRecording = true;
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };
      
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        if (this.onAudioAboveThresholdDetected) {
          this.onAudioAboveThresholdDetected(blob);
        }
        this.isRecording = false;
      };
      
      // Start recording with a longer duration to ensure we capture pre-trigger audio
      this.mediaRecorder.start(100); // Collect chunks every 100ms
      
      // Stop recording after the specified duration plus pre-trigger time
      setTimeout(() => {
        this.stopRecording();
      }, this.config.recordingDuration + this.config.preTriggerBufferDuration);
    }
  
    /**
     * Stop the current recording
     */
    private stopRecording(): void {
      if (this.mediaRecorder && this.isRecording) {
        this.mediaRecorder.stop();
      }
    }
  
    /**
     * Reset silence detection timer
     */
    public resetSilenceDetection(): void {
      if (this.silenceTimeout !== null) {
        clearTimeout(this.silenceTimeout);
      }
      
      this.silenceTimeout = window.setTimeout(() => {
        if (this.onSilenceDetected) {
          this.onSilenceDetected();
        }
      }, this.config.silenceDuration);
    }
  }
  
  export default AudioLoudnessMeter;