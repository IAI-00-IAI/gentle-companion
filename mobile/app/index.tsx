import { Redirect } from 'expo-router';

/** Entry route: QR first (V1), manual SSH as the alternative path (V2). */
export default function Index() {
  return <Redirect href="/scan-qr" />;
}
