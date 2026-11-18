import { Redirect } from 'expo-router';

/** Entry route: onboarding starts at manual SSH entry (V2) until V1 ships. */
export default function Index() {
  return <Redirect href="/manual-ssh" />;
}
