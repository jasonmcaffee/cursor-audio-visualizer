import { calculateLoudness, createAudioContext } from "./audioUtils";

export type AudioLoudnessMeterCallbacks = {
  onAudioAboveThresholdDetected?: (audioBlob: Blob) => void;
  onPeriodicVolumeInformation?: (volume: number) => void;
  onSilenceDetected?: (completeAudioBlob: Blob) => void;
}
/**
 * AI should not remove these comments:
 * Functionality:
 * when audio loudness threshold has been crossed, the audio blob sent to the onAudioAboveThresholdDetected callback should include audio that took place N ms (preTriggerBufferDuration) before the volume threshold was crossed.  Refer to this audio blob as initialLoudnessThresholdBlob.
 * when onSilenceDetected is called, it should pass an audio blob that includes  the initialLoudnessThresholdBlob, as well as all audio that has taken place between that audio and when silence detected was called.
 * i.e. if I say "hello Sienna", and "hello" is below the loudness threshold, but "Sienna" is above the loudness threshold, I should get an audio blob from onAudioAboveThresholdDetected that includes "hello Sienna".
 * ie. If I say "hello Sienna how are you today..." and keep talking for N seconds (over the recordingDuration amount), then I should get the full audio of everything that was said from "hello Sienna" until silence was detected.
 *  We want to get two different audio blobs: the first, as soon as possible, that is the length of the recordingDuration, and includes the initialLoudnessThresholdBlob, then we want to get the full audio of everything that was said until silence is detected.
 *  This will allow us to send the initial audio blob to Speech to Text, to see if it contains a keyword, like "hey siri", which will activate our use of an LLM, for which we will send the entire audio recording, up until silence, to in order to ask an LLM a question through speech to text.
 * All audio blobs created should be of the mime type specified. 
 * 
 * We will use a single ongoing media recorder to constantly record audio, then slice the audio when needed.
 * When the loudness threshold is exceeded, we will slice audio from the time that the threshold was exceeded minus the preTriggerBufferDuration. That point will be referred to as the audioStartPoint.  
 * When silece is detected, after the threshold is exceeded, the audio blob sent to the onSilenceDetected callback will include audio from the audioStartPoint until the time that silence was detected.
 * once the loudness threshold is crossed, no other loudness threshold events should take place until silence is detected.
 * All audio slices must have headers that match the mime type specified, and must be playable by the WebAudioPlayer.
 * 
 * IMPORTANT: We must use a single MediaRecorder instance throughout the entire lifecycle. Never create multiple MediaRecorders
 * as this will cause issues with audio format and headers. All audio slicing must be done using the chunks from this single recorder.
 */

class AudioLoudnessMeterV3 {
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private analyser: AnalyserNode | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private source: MediaStreamAudioSourceNode | null = null;
    
    // Recording state
    private isAnalyzing: boolean = false;
    private isRecording: boolean = false;
    private isInLoudnessEvent: boolean = false; // Track if we're between threshold crossing and silence
    private audioStartPoint: number = 0; // Timestamp when threshold was crossed minus preTriggerBufferDuration
    
    // Audio storage
    private audioChunks: Blob[] = [];
    private headerChunks: Blob[] = []; // Store initial chunks with headers
    private lastChunkTimestamp: number = 0;
    private hasCapturedHeaders: boolean = false;
    
    // Timers and timestamps
    private volumeInterval = -1;
    private silenceTimeout = -1;
    private lastLoudnessTime: number = 0;
    
    // Callbacks
    private onAudioAboveThresholdDetected: ((audioBlob: Blob) => void) | null = null;
    private onPeriodicVolumeInformation: ((volume: number) => void) | null = null;
    private onSilenceDetected: ((completeAudioBlob: Blob) => void) | null = null;
  
    // Configuration options with defaults
    private config = {
      loudnessThreshold: 10,           // Default loudness threshold (0-100)
      silenceDuration: 1000,          // Duration of silence before callback (ms)
      initialRecordingDuration: 1000, // Initial audio recording duration after trigger (ms)
      preTriggerBufferDuration: 20,  // Audio to keep before trigger (ms)
      volumeCheckInterval: 50,        // Interval for volume checking (ms)
      fftSize: 1024,                  // FFT size for analysis fftSize controls how detailed the frequency analysis is. Higher fftSize → better frequency resolution, but also more data and more CPU.
      currentMimeType: 'audio/webm;codecs=opus',
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      mediaStreamTimeSlice: 50,
    };
  
    constructor(config?: Partial<typeof AudioLoudnessMeterV3.prototype.config>) {
      if (config) {
        this.config = { ...this.config, ...config };
      }
    }
  
    public async start({onAudioAboveThresholdDetected, onPeriodicVolumeInformation, onSilenceDetected}: AudioLoudnessMeterCallbacks = {}) {
      if (this.isAnalyzing) {return;}
      console.log('starting AudioLoudnessMeterV3');
  
      // Set callbacks
      this.onAudioAboveThresholdDetected = onAudioAboveThresholdDetected || null;
      this.onPeriodicVolumeInformation = onPeriodicVolumeInformation || null;
      this.onSilenceDetected = onSilenceDetected || null;

      // Initialize audio context and get media stream
      this.audioContext = createAudioContext();
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: {echoCancellation: this.config.echoCancellation,noiseSuppression: this.config.noiseSuppression,autoGainControl: this.config.autoGainControl} });
      
      this.setupAudioAnalysis();
      this.startRecording();  
      this.isAnalyzing = true;
    }
  

    private setupAudioAnalysis(): void {
      if (!this.audioContext || !this.mediaStream) { return console.log('no audio context or media stream'); }
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
  
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.config.fftSize;
      this.analyser.smoothingTimeConstant = 0.3;
      this.source.connect(this.analyser);
   
      this.startVolumeChecking();
    }
  
    private startVolumeChecking(): void {
    
      let wasLoudnessOverThreshold = false;
      let silenceStartTime: number | null = null;
  
      this.volumeInterval = window.setInterval(() => {
        const normalizedLoudness = calculateLoudness(this.analyser!);
     
        this.onPeriodicVolumeInformation?.(normalizedLoudness);
        
        
        // Check if loudness crosses threshold
        const isLoudnessOverThreshold = normalizedLoudness >= this.config.loudnessThreshold;
        
        // Handle loudness detection
        if (isLoudnessOverThreshold && !wasLoudnessOverThreshold) {
          this.sendInitialBlobAfterInitialRecordingDuration();
          silenceStartTime = null; // Reset silence timer when loudness is detected
        } 
        
        // Handle silence detection
        if (!isLoudnessOverThreshold && wasLoudnessOverThreshold) {
          // Start timing silence when loudness drops below threshold
          silenceStartTime = Date.now();
        } else if (!isLoudnessOverThreshold && silenceStartTime !== null) {
          // Check if we've been silent for long enough
          const silenceDuration = Date.now() - silenceStartTime;
          if (silenceDuration >= this.config.silenceDuration) {
            this.sendSilenceDetectedAfterSilenceDuration();
            silenceStartTime = null;
          }
        }
        
        wasLoudnessOverThreshold = isLoudnessOverThreshold;
      }, this.config.volumeCheckInterval);
    }
  
    private sendInitialBlobAfterInitialRecordingDuration(): void {
      // Only handle loudness detection if we're not already in a loudness event
      if (this.isInLoudnessEvent) {
        return;
      }
  
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = -1;
      
      // Set the audio start point (threshold time minus pre-trigger buffer)
      this.audioStartPoint = Date.now() - this.config.preTriggerBufferDuration;
      this.isInLoudnessEvent = true;
      
      // After initial recording duration, send the initial blob
      setTimeout(() => {
        if (this.isRecording) {
          this.sendInitialBlob();
        }
      }, this.config.initialRecordingDuration);
    }
  
    private async startRecording() {
     
      this.mediaRecorder = new MediaRecorder(this.mediaStream!, {mimeType: this.config.currentMimeType,audioBitsPerSecond: 128000});
      const recordingStartTimeMs = Date.now();
      let lastAudioChunkEndTimeMs = 0;

      // Reset audio chunks but keep header chunks if we have them
      this.audioChunks = [];
      if (!this.hasCapturedHeaders) {
        this.headerChunks = [];
      }
      this.isRecording = true;
      this.lastChunkTimestamp = Date.now();
      const numberOfChunksToCaptureAsHeaders = 2;
      this.mediaRecorder.ondataavailable = (event) => {
        // const audioChunkEndTimeMs = Date.now() - recordingStartTimeMs;
        if (event.data.size > 0) {
          // Store the first few chunks as header chunks if we haven't captured them yet
          if (!this.hasCapturedHeaders && this.headerChunks.length < numberOfChunksToCaptureAsHeaders) {
            this.headerChunks.push(event.data);
            if (this.headerChunks.length >= numberOfChunksToCaptureAsHeaders) {
              this.hasCapturedHeaders = true;
            }
          }
          //@ts-ignore
          event.data.audioChunkEndTimeMs = Date.now();
          //@ts-ignore
          // event.data.audioChunkStartTimeMs = lastAudioChunkEndTimeMs;
          this.audioChunks.push(event.data);
          this.lastChunkTimestamp = Date.now();
          // lastAudioChunkEndTimeMs = audioChunkEndTimeMs;
        }
      };
      
      // Start recording with small time slices for precise control
      this.mediaRecorder.start(this.config.mediaStreamTimeSlice);
    }
  
    private stopRecording(): void {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
      this.isRecording = false;
    }
  
    private sendInitialBlob(): void {
      if (!this.isRecording || this.audioChunks.length === 0) {
        return;
      }
  
      // Find chunks that fall within our time window
      // const relevantChunks = this.audioChunks.filter((_, index) => {
      //   const chunkTime = this.lastChunkTimestamp - (this.audioChunks.length - index - 1) * this.config.mediaStreamTimeSlice;
      //   return chunkTime >= this.audioStartPoint && 
      //          chunkTime <= this.audioStartPoint + this.config.initialRecordingDuration;
      // });

      const relevantChunks = this.audioChunks.filter((chunk, index) => {
        //@ts-ignore
        const chunkTime = chunk.audioChunkEndTimeMs;
        return chunkTime >= this.audioStartPoint && 
               chunkTime <= this.audioStartPoint + this.config.initialRecordingDuration;
      });
  
      if (relevantChunks.length > 0) {
        // Create blob with headers first, then relevant chunks
        const initialBlob = new Blob([...this.headerChunks, ...relevantChunks], { type: this.config.currentMimeType });
        if (this.onAudioAboveThresholdDetected) {
          this.onAudioAboveThresholdDetected(initialBlob);
        }
      }
    }
  
    private sendCompleteBlob(): void {
      if (!this.isRecording || this.audioChunks.length === 0) {
        return;
      }
  
      // Find chunks from audioStartPoint until now
      const relevantChunks = this.audioChunks.filter((chunk, index) => {
        //@ts-ignore
        const chunkTime = chunk.audioChunkEndTimeMs;
        return chunkTime >= this.audioStartPoint;
      });
  
      if (relevantChunks.length > 0) {
        // Create blob with headers first, then relevant chunks
        const completeBlob = new Blob([...this.headerChunks, ...relevantChunks], { type: this.config.currentMimeType });
        if (this.onSilenceDetected) {
          this.onSilenceDetected(completeBlob);
        }
      }
    }
  
    public sendSilenceDetectedAfterSilenceDuration(): void {
      if (this.silenceTimeout !== null) {
        clearTimeout(this.silenceTimeout);
      }
  
      this.silenceTimeout = window.setTimeout(() => {
        if (this.isRecording) {
          this.sendCompleteBlob();
          this.stopRecording();
          this.isInLoudnessEvent = false; // Reset the flag after silence is detected
          // Restart recording after silence is detected
          this.startRecording();
        }
      }, this.config.silenceDuration);
    }

    public stop(): void {
        if (!this.isAnalyzing) { return; }
        clearInterval(this.volumeInterval);
        this.volumeInterval = -1;
        clearTimeout(this.silenceTimeout);
        this.silenceTimeout = -1;
        
        // Stop recording
        this.stopRecording();
    
        this.source?.disconnect();
        this.source = null;
        this.analyser?.disconnect();
        this.analyser = null;
        this.mediaStream?.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
        this.audioContext?.close();
        this.audioContext = null;
    
        // Reset state
        this.isAnalyzing = false;
        this.isRecording = false;
        this.isInLoudnessEvent = false;
        this.audioStartPoint = 0;
        this.audioChunks = [];
        this.headerChunks = [];
        this.lastChunkTimestamp = 0;
        this.hasCapturedHeaders = false;
        this.lastLoudnessTime = 0;
      }
  }
  
  export default AudioLoudnessMeterV3;
