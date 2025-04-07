'use client';
import { Buffer } from 'buffer';

// Polyfill Buffer for browser environments
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
}    
import { FaMicrophone, FaPlay, FaPause } from 'react-icons/fa';
import { useState, useEffect } from 'react';
import styles from './page.module.css';
import LoudnessMeter from './components/LoudnessMeter';
import CallbackCounters from './components/CallbackCounters';
import WebAudioPlayer from './services/WebAudioPlayer';
import VoiceCommandSensitiveAudioPlayer from './services/VoiceCommandSensitiveAudioPlayer';

const webAudioPlayer = new WebAudioPlayer();
const voiceCommandSensitiveAudioPlayer = new VoiceCommandSensitiveAudioPlayer();

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [currentVolume, setCurrentVolume] = useState(0);
  const [volumeInfoCount, setVolumeInfoCount] = useState(0);
  const [audioAboveThresholdCount, setAudioAboveThresholdCount] = useState(0);
  const [silenceDetectedCount, setSilenceDetectedCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [alanWattsAudioBlob, setAlanWattsAudioBlob] = useState<Blob | null>(null);
  const [hasAlreadyEnqueuedAlanWattsAudio, setHasAlreadyEnqueuedAlanWattsAudio] = useState(false);
  async function fetchAudioBlob(){
    console.log('fetching audio blob');
    const response = await fetch('sounds/Alan Watts - Buddhism Religion of No Religion  1.mp3');
    const audioBlob = await response.blob();
    setAlanWattsAudioBlob(audioBlob);
  }
  useEffect(() => {
    if(!alanWattsAudioBlob){
      fetchAudioBlob();
    }
  }, []);

  const handlePlayClick = async () => {
    if (isPlaying) {
      voiceCommandSensitiveAudioPlayer.pauseEnqueuedAudio();
    } else {
      if(!hasAlreadyEnqueuedAlanWattsAudio){
        // await webAudioPlayer.playAudioFile('sounds/Alan Watts - Buddhism Religion of No Religion  1.mp3');
        voiceCommandSensitiveAudioPlayer.enqueueAudio(alanWattsAudioBlob!);
        setHasAlreadyEnqueuedAlanWattsAudio(true);
      }
      voiceCommandSensitiveAudioPlayer.playEnqueuedAudio();
    }
    setIsPlaying(!isPlaying);
  };

  const handleRecordClick = async () => {
    if (isRecording) {
      voiceCommandSensitiveAudioPlayer.stopListening();
      setIsRecording(false);
      return;
    }

    await voiceCommandSensitiveAudioPlayer.startListening({
      onPeriodicVolumeInformation: (volume: number) => {
        setCurrentVolume(volume);
        setVolumeInfoCount(prev => prev + 1);
      },
      onAudioAboveThresholdDetected: async (audioBlob: Blob) => {
        setAudioAboveThresholdCount(prev => prev + 1);
      },
      onSilenceDetected: async (audioBlob: Blob) => {
        setSilenceDetectedCount(prev => prev + 1);
      },
    });
    setIsRecording(true);
  };

  return (
    <main className={styles.container}>
      <button 
        className={`${styles.playButton} ${isPlaying ? styles.playing : ''}`}
        onClick={handlePlayClick}
      >
        {isPlaying ? <FaPause /> : <FaPlay />}
        {isPlaying ? 'Pause' : 'Play Alan Watts'}
      </button>

      <button 
        className={`${styles.recordButton} ${isRecording ? styles.recording : ''}`}
        onClick={handleRecordClick}
      >
        <FaMicrophone />
        {isRecording ? 'Stop Recording' : 'Record'}
      </button>

      {/* do not check if it is recording. always display */}
      <LoudnessMeter volume={currentVolume} />
      <CallbackCounters
        volumeInfoCount={volumeInfoCount}
        audioAboveThresholdCount={audioAboveThresholdCount}
        silenceDetectedCount={silenceDetectedCount}
      />
    </main>
  );
}

