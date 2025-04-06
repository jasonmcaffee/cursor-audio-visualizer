'use client';

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


  const handlePlayClick = async () => {
    if (!webAudioPlayer) return;
    if (isPlaying) {
      webAudioPlayer.stop();
    } else {
      try {
        await webAudioPlayer.playAudioFile('sounds/Alan Watts - Buddhism Religion of No Religion  1.mp3');
       
      } catch (error) {
        console.error('Error playing audio file:', error);
      }
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

