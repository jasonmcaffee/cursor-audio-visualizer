import styles from './CallbackCounters.module.css';

interface CallbackCountersProps {
  volumeInfoCount: number;
  audioAboveThresholdCount: number;
  silenceDetectedCount: number;
}

export default function CallbackCounters({
  volumeInfoCount,
  audioAboveThresholdCount,
  silenceDetectedCount,
}: CallbackCountersProps) {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h3>Volume Updates</h3>
        <p>{volumeInfoCount}</p>
      </div>
      <div className={styles.card}>
        <h3>Audio Above Threshold</h3>
        <p>{audioAboveThresholdCount}</p>
      </div>
      <div className={styles.card}>
        <h3>Silence Detected</h3>
        <p>{silenceDetectedCount}</p>
      </div>
    </div>
  );
} 