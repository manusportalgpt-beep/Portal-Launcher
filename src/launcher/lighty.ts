import { invoke } from '@/lib/invoke-shim';

export async function isLightyAvailable(): Promise<boolean> {
  try {
    return await invoke('lighty_available') as boolean;
  } catch (e) {
    return false;
  }
}

export async function launchInstanceWithLighty(instanceId: string, instanceDir?: string) {
  return await invoke('launch_with_lighty', { req: { instance_id: instanceId, instance_dir: instanceDir } });
}
