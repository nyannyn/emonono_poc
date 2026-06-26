import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeView from '../screens/HomeView';
import RecordingView from '../screens/RecordingView';
import NotesView from '../screens/NotesView';
import SettingsView from '../screens/SettingsView';
import MeetingsView from '../screens/MeetingsView';
import MembersView from '../screens/MembersView';
import VoiceprintRegisterView from '../screens/VoiceprintRegisterView';
import SpeakerMappingView from '../screens/SpeakerMappingView';
import LiveRecordingView from '../screens/LiveRecordingView';
import RealtimeRecordingView from '../screens/RealtimeRecordingView';

export type RootStackParamList = {
  Home: undefined;
  Recording: { uploadedFileUri?: string; retryMeetingId?: number } | undefined;
  Live: undefined;
  Realtime: undefined;
  Notes: { transcript?: string; meetingId?: number };
  Meetings: undefined;
  Members: undefined;
  VoiceprintRegister: undefined;
  SpeakerMapping: { meetingId: number };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="Home" component={HomeView} />
        <Stack.Screen name="Recording" component={RecordingView} />
        <Stack.Screen name="Live" component={LiveRecordingView} />
        <Stack.Screen name="Realtime" component={RealtimeRecordingView} />
        <Stack.Screen name="Notes" component={NotesView} />
        <Stack.Screen name="Meetings" component={MeetingsView} />
        <Stack.Screen name="Members" component={MembersView} />
        <Stack.Screen name="VoiceprintRegister" component={VoiceprintRegisterView} />
        <Stack.Screen name="SpeakerMapping" component={SpeakerMappingView} />
        <Stack.Screen name="Settings" component={SettingsView} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
