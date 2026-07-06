
export interface DeviceInfo {
  deviceId: string;
  groupId: string;
  kind: MediaDeviceKind;
  label: string;
}

export type DeviceHealthStatus = "ok" | "disconnected" | "changed" | "perm-revoked";

export interface DeviceHealthReport {
  deviceId: string;
  kind: "audioinput" | "audiooutput";
  status: DeviceHealthStatus;
  previousLabel: string;
  currentLabel: string;
}

const STORAGE_KEY_INPUT = "pref_input_device";
const STORAGE_KEY_OUTPUT = "pref_output_device";

class AudioDeviceManager {
  private inputs: DeviceInfo[] = [];
  private outputs: DeviceInfo[] = [];
  private prevInputs: DeviceInfo[] = [];
  private prevOutputs: DeviceInfo[] = [];
  private changeCbs: Array<(inputs: DeviceInfo[], outputs: DeviceInfo[]) => void> = [];
  private healthCbs: Array<(reports: DeviceHealthReport[]) => void> = [];
  private deviceChangeHandler: (() => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private granted = false;

  async enumerate(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      const raw = await navigator.mediaDevices.enumerateDevices();

      const mapDevice = (d: MediaDeviceInfo): DeviceInfo => ({
        deviceId: d.deviceId,
        groupId: d.groupId,
        kind: d.kind,
        label: d.label || (d.kind === "audioinput" ? "Audio Input" : "Audio Output"),
      });

      this.prevInputs = this.inputs;
      this.prevOutputs = this.outputs;

      this.inputs = raw.filter((d) => d.kind === "audioinput").map(mapDevice);
      this.outputs = raw.filter((d) => d.kind === "audiooutput").map(mapDevice);

      const reports = this.detectChanges();
      if (reports.length > 0) {
        this.healthCbs.forEach((cb) => cb(reports));
      }

      this.changeCbs.forEach((cb) => cb(this.inputs, this.outputs));
    } catch (err) {
      console.error("Device enumeration failed:", err);
    }
  }

  getInputDevices(): DeviceInfo[] {
    return this.inputs;
  }

  getOutputDevices(): DeviceInfo[] {
    return this.outputs;
  }

  loadPersisted(): { inputId: string | null; outputId: string | null } {
    try {
      const inputId = localStorage.getItem(STORAGE_KEY_INPUT);
      const outputId = localStorage.getItem(STORAGE_KEY_OUTPUT);
      return {
        inputId: inputId && this.inputs.some((d) => d.deviceId === inputId) ? inputId : null,
        outputId: outputId && this.outputs.some((d) => d.deviceId === outputId) ? outputId : null,
      };
    } catch {
      return { inputId: null, outputId: null };
    }
  }

  persistInput(deviceId: string): void {
    try {
      localStorage.setItem(STORAGE_KEY_INPUT, deviceId);
    } catch {
      /* noop */
    }
  }

  persistOutput(deviceId: string): void {
    try {
      localStorage.setItem(STORAGE_KEY_OUTPUT, deviceId);
    } catch {
      /* noop */
    }
  }

  isInputAvailable(deviceId: string): boolean {
    return this.inputs.some((d) => d.deviceId === deviceId);
  }

  isOutputAvailable(deviceId: string): boolean {
    return this.outputs.some((d) => d.deviceId === deviceId);
  }

  getInputHealth(deviceId: string): DeviceHealthStatus {
    if (!this.prevInputs.length) return "ok";
    const was = this.prevInputs.find((d) => d.deviceId === deviceId);
    const is = this.inputs.find((d) => d.deviceId === deviceId);
    if (was && !is) return "disconnected";
    if (was && is && was.label !== is.label) return "changed";
    if (!this.inputs.length && this.granted) return "perm-revoked";
    return "ok";
  }

  getOutputHealth(deviceId: string): DeviceHealthStatus {
    if (!this.prevOutputs.length) return "ok";
    const was = this.prevOutputs.find((d) => d.deviceId === deviceId);
    const is = this.outputs.find((d) => d.deviceId === deviceId);
    if (was && !is) return "disconnected";
    if (was && is && was.label !== is.label) return "changed";
    return "ok";
  }

  private detectChanges(): DeviceHealthReport[] {
    const reports: DeviceHealthReport[] = [];
    if (!this.prevInputs.length && !this.prevOutputs.length) return reports;

    const checkList = (prev: DeviceInfo[], current: DeviceInfo[], kind: "audioinput" | "audiooutput") => {
      const seen = new Set<string>();
      for (const prevDev of prev) {
        seen.add(prevDev.deviceId);
        const curr = current.find((d) => d.deviceId === prevDev.deviceId);
        if (!curr) {
          reports.push({
            deviceId: prevDev.deviceId,
            kind,
            status: "disconnected",
            previousLabel: prevDev.label,
            currentLabel: "",
          });
        } else if (curr.label !== prevDev.label) {
          reports.push({
            deviceId: prevDev.deviceId,
            kind,
            status: "changed",
            previousLabel: prevDev.label,
            currentLabel: curr.label,
          });
        }
      }
      if (
        this.granted &&
        current.length > 0 &&
        current.every((d) => d.deviceId === "" || d.label === "")
      ) {
        for (const prevDev of prev) {
          if (!reports.some((r) => r.deviceId === prevDev.deviceId)) {
            reports.push({
              deviceId: prevDev.deviceId,
              kind,
              status: "perm-revoked",
              previousLabel: prevDev.label,
              currentLabel: "",
            });
          }
        }
      }
    };

    checkList(this.prevInputs, this.inputs, "audioinput");
    checkList(this.prevOutputs, this.outputs, "audiooutput");
    return reports;
  }

  onDeviceChange(cb: (inputs: DeviceInfo[], outputs: DeviceInfo[]) => void): void {
    this.changeCbs.push(cb);
  }

  onHealthChange(cb: (reports: DeviceHealthReport[]) => void): void {
    this.healthCbs.push(cb);
  }

  removeDeviceChangeListener(cb: (inputs: DeviceInfo[], outputs: DeviceInfo[]) => void): void {
    this.changeCbs = this.changeCbs.filter((c) => c !== cb);
  }

  removeHealthChangeListener(cb: (reports: DeviceHealthReport[]) => void): void {
    this.healthCbs = this.healthCbs.filter((c) => c !== cb);
  }

  setPermissionGranted(granted: boolean): void {
    this.granted = granted;
  }

  startListening(): void {
    if (this.deviceChangeHandler) return;
    this.deviceChangeHandler = () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.enumerate().catch(console.error);
      }, 300);
    };
    navigator.mediaDevices.addEventListener("devicechange", this.deviceChangeHandler);
  }

  stopListening(): void {
    if (this.deviceChangeHandler) {
      navigator.mediaDevices.removeEventListener("devicechange", this.deviceChangeHandler);
      this.deviceChangeHandler = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  dispose(): void {
    this.stopListening();
    this.changeCbs = [];
    this.healthCbs = [];
    this.inputs = [];
    this.outputs = [];
    this.prevInputs = [];
    this.prevOutputs = [];
  }
}

export const audioDeviceManager = new AudioDeviceManager();
