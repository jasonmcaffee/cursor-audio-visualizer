import { calculateLoudness, createAudioContext } from "./audioUtils";

export type AudioLoudnessMeterCallbacks = {
  onAudioAboveThresholdDetected?: (audioBlob: Blob) => void;
  onPeriodicVolumeInformation?: (volume: number) => void;
  onSilenceDetected?: (completeAudioBlob: Blob) => void;
}

type ExtendedBlob = Blob & {
  dateTimeBlobEnded: number;
};

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
    private audioShouldStartAtThisDateTime: number = 0; // Timestamp when threshold was crossed minus preTriggerBufferDuration
    
    // Audio storage
    private audioChunks: ExtendedBlob[] = [];
    private headerChunks: Blob[] = []; // Store initial chunks with headers
    
    // Timers and timestamps
    private volumeExceededThresholdIntervalId = -1;
    private silenceVolumeIntervalId = -1;
    private periodicVolumeCalcIntervalId = -1;
    private silenceTimeout = -1;
    private lastLoudnessTime: number = 0;
    
    // Callbacks
    private onAudioAboveThresholdDetected: ((audioBlob: Blob) => void) | null = null;
    private onPeriodicVolumeInformation: ((volume: number) => void) | null = null;
    private onSilenceDetected: ((completeAudioBlob: Blob) => void) | null = null;
  
    // Configuration options with defaults
    private config = {
      loudnessThreshold: 6,           // Default loudness threshold (0-100)
      amountOfSilenceMsBeforeOnSilenceIsTriggered: 1000,          // Duration of silence before callback (ms)
      initialRecordingDuration: 1000, // Initial audio recording duration after trigger (ms)
      msWorthOfAudioThatShouldBeIncludedBeforVolumeThresholdWasCrossed: 100,  // Audio to keep before trigger (ms)
      volumeCheckIntervalMs: 10,        // Interval for volume checking (ms)
      fftSize: 2048,                  // FFT size for analysis fftSize controls how detailed the frequency analysis is. Higher fftSize → better frequency resolution, but also more data and more CPU.
      currentMimeType: 'audio/webm;codecs=opus',
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      mediaStreamTimeSlice: 10,
      numberOfChunksToCaptureAsHeaders: 2,
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
  
    private startVolumeChecking() {
      let loudnessDetectedStartTime: number | null = null; //gets reset after we process.
      let silenceDetectedStartTime: number | null = null; 
      let processingAudioThresholdExceededEvent = false; // starts when one second of audio has been collected after the threshold was crossed.

      const collectAudioDataUntilInitialRecordingDuration = () => {
        const msOfAudioDataCollected = Date.now() - loudnessDetectedStartTime!;
        if(msOfAudioDataCollected >= this.config.initialRecordingDuration) {
          loudnessDetectedStartTime = null;
          processingAudioThresholdExceededEvent = true; //don't let any more of these process until silence is detected.
          this.triggerOnAudioAboveThresholdDetected();
        }
      }

      let normalizedLoudness = 0;
      let isLoudnessOverThreshold = false;

      this.periodicVolumeCalcIntervalId = window.setInterval(() => {
        normalizedLoudness = calculateLoudness(this.analyser!);
        this.onPeriodicVolumeInformation?.(normalizedLoudness);
        isLoudnessOverThreshold = normalizedLoudness >= this.config.loudnessThreshold;
        loudnessDetection();
        silenceDetection();
      }, this.config.volumeCheckIntervalMs);

     

      const loudnessDetection = () => {
        if(processingAudioThresholdExceededEvent) { return; } //we don't want to send multiple events as threshold keeps getting crossed.

        if(loudnessDetectedStartTime != null) {   //already processing.
          collectAudioDataUntilInitialRecordingDuration();
          return; 
        }

        if(isLoudnessOverThreshold) {
          console.log('isLoudnessOverThreshold');
          loudnessDetectedStartTime = Date.now();
          //tell the blob collector which audio chunks to include.
          this.audioShouldStartAtThisDateTime = Date.now() - this.config.msWorthOfAudioThatShouldBeIncludedBeforVolumeThresholdWasCrossed;
        }
      };

      const silenceDetection = () => {
        if(!processingAudioThresholdExceededEvent) { return; }

        //if the loudness crosses the threshold, reset the silence timer.
        if(isLoudnessOverThreshold) {
          silenceDetectedStartTime = null;
        }if(!processingAudioThresholdExceededEvent) { return; }

        //if the loudness crosses the threshold, reset the silence timer.
        if(isLoudnessOverThreshold) {
          silenceDetectedStartTime = null;
        }

        //if the loudness does not cross the threshold, and the silence timer is not running, start it.
        if(!isLoudnessOverThreshold && silenceDetectedStartTime == null) {
          silenceDetectedStartTime = Date.now();
        }

        //if the silence timer is running, and the duration has exceeded the silence duration, trigger the silence detected event.
        if(silenceDetectedStartTime != null) { 
          const silenceDuration = Date.now() - silenceDetectedStartTime!;
          // console.log('silenceDuration', silenceDuration);
          if(silenceDuration >= this.config.amountOfSilenceMsBeforeOnSilenceIsTriggered) {
            this.triggerOnSilenceDetected();
            silenceDetectedStartTime = null;
            processingAudioThresholdExceededEvent = false;
          }
        }
      };

    }
  

    private async startRecording() {
      this.mediaRecorder = new MediaRecorder(this.mediaStream!, {mimeType: this.config.currentMimeType,audioBitsPerSecond: 128000});

      // Reset audio chunks but keep header chunks if we have them
      this.audioChunks = [];
      // this.headerChunks = [];
      this.isRecording = true;
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          // Store the first few chunks as header chunks if we haven't captured them yet
          if (this.headerChunks.length < this.config.numberOfChunksToCaptureAsHeaders) {
            this.headerChunks.push(event.data);
          }
          const extendedBlob = event.data as ExtendedBlob;
          extendedBlob.dateTimeBlobEnded = Date.now();

          this.audioChunks.push(extendedBlob);
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
  
    private triggerOnAudioAboveThresholdDetected() {
      const startTime = Date.now();
      if (!this.isRecording || this.audioChunks.length === 0) {
        return;
      }

      const relevantChunks = this.audioChunks.filter((chunk, index) => {
        const chunkTime = chunk.dateTimeBlobEnded;
        return chunkTime >= this.audioShouldStartAtThisDateTime && 
               chunkTime <= this.audioShouldStartAtThisDateTime + this.config.initialRecordingDuration;
      });
  
      if (relevantChunks.length > 0) {
        // Create blob with headers first, then relevant chunks
        const initialBlob = new Blob([...this.headerChunks, ...relevantChunks], { type: this.config.currentMimeType });
        if (this.onAudioAboveThresholdDetected) {
          this.onAudioAboveThresholdDetected(initialBlob);
        }
      }
      const endTime = Date.now();
      // console.log('triggerOnAudioAboveThresholdDetected took ', endTime - startTime, 'ms');  
    }
  
    private triggerOnSilenceDetected() {
      if (!this.isRecording || this.audioChunks.length === 0) {
        return;
      }
  
      // Find chunks from audioStartPoint until now
      const relevantChunks = this.audioChunks.filter((chunk, index) => {
        const chunkTime = chunk.dateTimeBlobEnded;
        return chunkTime >= this.audioShouldStartAtThisDateTime;
      });
  
      if (relevantChunks.length > 0) {
        // Create blob with headers first, then relevant chunks
        const completeBlob = new Blob([...this.headerChunks, ...relevantChunks], { type: this.config.currentMimeType });
        if (this.onSilenceDetected) {
          this.onSilenceDetected(completeBlob);
        }
      }
    }
  
    
    public stop(): void {
        if (!this.isAnalyzing) { return; }
        clearInterval(this.volumeExceededThresholdIntervalId);
        this.volumeExceededThresholdIntervalId = -1; 
        clearInterval(this.silenceVolumeIntervalId);
        this.silenceVolumeIntervalId = -1;
        clearTimeout(this.silenceTimeout);
        this.silenceTimeout = -1;
        clearInterval(this.periodicVolumeCalcIntervalId);
        this.periodicVolumeCalcIntervalId = -1;
        
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
        this.audioShouldStartAtThisDateTime = 0;
        this.audioChunks = [];
        this.headerChunks = [];
        this.lastLoudnessTime = 0;
      }
  }
  
  export default AudioLoudnessMeterV3;
