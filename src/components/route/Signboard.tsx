/**
 * Shows signboard text the way commuters see it on a jeepney or UV Express:
 * bold capitals on a dark board. Helps people match the vehicle quickly.
 */
export function Signboard({ text }: { text: string }) {
  return (
    <span className="inline-block rounded-lg border-2 border-sun-400 bg-navy-900 px-2.5 py-1 font-extrabold tracking-wider text-sun-300 uppercase shadow-sm">
      <span className="sr-only">Signboard: </span>
      {text}
    </span>
  );
}
