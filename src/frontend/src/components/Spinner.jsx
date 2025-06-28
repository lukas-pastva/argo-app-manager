export default function Spinner({ size = 24 }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      aria-label="loading"
    />
  );
}
