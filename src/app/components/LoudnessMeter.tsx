import styles from './LoudnessMeter.module.css';

interface LoudnessMeterProps {
  volume: number;
}

export default function LoudnessMeter({ volume }: LoudnessMeterProps) {
  return (
    <div className={styles.meterContainer}>
      <div 
        className={styles.meterBar} 
        style={{ height: `${volume}%` }}
      />
      {/* <div className={styles.volumeNumber}>
        {volume}
      </div> */}
    </div>
  );
} 