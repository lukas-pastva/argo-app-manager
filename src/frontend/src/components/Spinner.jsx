export default function Spinner({ size = 24 }) {
  const dim = `${size}px`;
  return (
    <span
      className="spinner"
      style={{ width: dim, height: dim }}
      aria-label="loading"
    />
  );
}
