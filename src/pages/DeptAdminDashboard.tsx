import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CalendarCheck,
  Download,
  History,
  Users,
  Plus,
  Upload,
  Save,
  Trash2,
  Check,
  X,
  CheckCheck,
  XCircle,
  Search,
  Database,
  AlertCircle,
  RefreshCw,
  WifiOff,
  Loader2,
  QrCode,
  KeyRound,
  Copy,
  ShieldCheck,
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { ProgressSummary } from "@/components/ProgressSummary";
import LoadingScreen from "@/components/LoadingScreen";
import { QRCodeCanvas } from "qrcode.react";
import { LocationPicker } from "@/components/LocationPicker";
import { DashboardHeader } from "@/components/dept-admin/DashboardHeader";
import { CourseSelector } from "@/components/dept-admin/CourseSelector";
import { DepartmentToolbar } from "@/components/dept-admin/DepartmentToolbar";
import type { DepartmentCourse } from "@/components/dept-admin/types";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface Student {
  id: string;
  name: string;
  gender: string | null;
  matric_no: string | null;
  department_id: string;
}

interface AttendanceRecord {
  id: string;
  student_ref: string;
  course_id: string;
  date: string;
  status: string;
  students: {
    name: string;
    matric_no: string | null;
    gender: string | null;
  } | null;
  courses: {
    name: string;
    code: string;
  } | null;
}

interface LocalAttendance {
  studentId: string;
  courseId: string;
  date: string;
  status: "P" | "A";
  synced: boolean;
  error?: string;
}

const DeptAdminDashboard = () => {
  const { profile, user } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [departmentName, setDepartmentName] = useState<string>("");
  const [courses, setCourses] = useState<DepartmentCourse[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>("");
  const [dateColumns, setDateColumns] = useState<string[]>([
    new Date().toISOString().split("T")[0],
  ]);
  const [grid, setGrid] = useState<
    Record<string, Record<string, "P" | "A" | "">>
  >({});
  const [localAttendance, setLocalAttendance] = useState<LocalAttendance[]>([]);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [activeTab, setActiveTab] = useState<
    "mark" | "history" | "students" | "logins"
  >("mark");
  const [loginEvents, setLoginEvents] = useState<
    Array<{
      id: string;
      created_at: string;
      event: string;
      matric_no: string | null;
      student_id: string | null;
      detail: any;
    }>
  >([]);
  const [loginEventsLoading, setLoginEventsLoading] = useState(false);
  const [loginEventFilter, setLoginEventFilter] = useState<
    "all" | "success" | "blocked_already_used" | "reset"
  >("all");
  const [loginEventSearch, setLoginEventSearch] = useState("");
  const [historySource, setHistorySource] = useState<"local" | "sheet">(
    "local",
  );
  const [sheetHistory, setSheetHistory] = useState<AttendanceRecord[]>([]);
  const [sheetHistoryLoading, setSheetHistoryLoading] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [studentEdits, setStudentEdits] = useState<
    Record<string, Partial<Student>>
  >({});
  const [savingStudents, setSavingStudents] = useState(false);
  const [syncingAttendance, setSyncingAttendance] = useState(false);
  const [sheetsBusy, setSheetsBusy] = useState<false | "sync" | "export">(
    false,
  );
  const [connectionStatus, setConnectionStatus] = useState<
    "online" | "offline" | "checking"
  >("checking");
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [qrSession, setQrSession] = useState<{
    token: string;
    expires_at: string;
    course_id: string;
    date: string;
  } | null>(null);
  const [qrCourseId, setQrCourseId] = useState<string>("");
  const [qrDate, setQrDate] = useState<string>(
    new Date().toISOString().split("T")[0],
  );
  const [qrDurationMin, setQrDurationMin] = useState<number>(15);
  const [qrCreating, setQrCreating] = useState(false);
  const [qrLat, setQrLat] = useState<number | null>(null);
  const [qrLng, setQrLng] = useState<number | null>(null);
  const [qrRadius, setQrRadius] = useState<number>(100);
  const [qrEnding, setQrEnding] = useState(false);
  const [provisioningAuth, setProvisioningAuth] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [rotatingCode, setRotatingCode] = useState<string | null>(null);
  useEffect(() => {
    if (!qrSession) {
      setRotatingCode(null);
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    let cancelled = false;
    const pull = async () => {
      const { data } = await supabase.functions.invoke("session-token", {
        body: { token: qrSession.token },
      });
      if (!cancelled && (data as any)?.code)
        setRotatingCode((data as any).code);
    };
    pull();
    const poll = setInterval(pull, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(poll);
    };
  }, [qrSession]);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newStudent, setNewStudent] = useState({
    name: "",
    gender: "",
    matric_no: "",
  });
  const [addingStudent, setAddingStudent] = useState(false);

  const [showCourseDialog, setShowCourseDialog] = useState(false);
  const [newCourse, setNewCourse] = useState({ name: "", code: "" });
  const [addingCourse, setAddingCourse] = useState(false);

  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareFileName, setShareFileName] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const pdfBlobRef = useRef<Blob | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [historyCourseFilter, setHistoryCourseFilter] = useState<string>("all");
  const [filterPercent, setFilterPercent] = useState<string>("all");
  const [deletingHistory, setDeletingHistory] = useState(false);

  // Check connection status
  useEffect(() => {
    const checkConnection = async () => {
      setConnectionStatus("checking");
      try {
        const { error } = await supabase
          .from("attendance")
          .select("count", { count: "exact", head: true });
        setConnectionStatus(error ? "offline" : "online");
      } catch {
        setConnectionStatus("offline");
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!profile?.department_id) return;
    initializeDashboard();
  }, [profile?.department_id]);

  useEffect(() => {
    if (!initialLoading) {
      saveLocalAttendance();
    }
  }, [localAttendance]);

  useEffect(() => {
    if (selectedCourse) {
      fetchAttendanceGrid();
    }
  }, [selectedCourse, dateColumns]);

  // Live updates: refresh grid + history when attendance changes in this department (e.g. QR scans).
  const liveRefreshRef = useRef<() => void>(() => {});
  liveRefreshRef.current = () => {
    if (selectedCourse) fetchAttendanceGrid();
    fetchHistory();
  };
  useEffect(() => {
    if (!profile?.department_id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`attendance-live-${profile.department_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendance",
          filter: `department_id=eq.${profile.department_id}`,
        },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => liveRefreshRef.current(), 600);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [profile?.department_id]);

  const initializeDashboard = async () => {
    try {
      setInitialLoading(true);
      await Promise.all([
        fetchStudents(),
        fetchHistory(),
        fetchDepartmentName(),
        fetchCourses(),
        loadLocalAttendance(),
      ]);
    } catch (error) {
      console.error("Error initializing dashboard:", error);
      toast.error("Failed to load dashboard data. Please refresh the page.");
    } finally {
      setInitialLoading(false);
    }
  };

  const loadLocalAttendance = () => {
    const saved = localStorage.getItem(`attendance_${profile?.department_id}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setLocalAttendance(parsed);

        const localGrid: Record<string, Record<string, "P" | "A" | "">> = {};
        parsed.forEach((item: LocalAttendance) => {
          if (!localGrid[item.studentId]) localGrid[item.studentId] = {};
          localGrid[item.studentId][item.date] = item.status;
        });

        setGrid((prev) => {
          const merged = { ...prev };
          Object.keys(localGrid).forEach((studentId) => {
            merged[studentId] = {
              ...merged[studentId],
              ...localGrid[studentId],
            };
          });
          return merged;
        });

        const pendingCount = parsed.filter(
          (item: LocalAttendance) => !item.synced,
        ).length;
        if (pendingCount > 0) {
          toast.info(`${pendingCount} unsynced attendance records found`);
        }
      } catch (e) {
        console.error("Failed to load local attendance:", e);
        toast.error("Failed to load saved attendance data");
      }
    }
  };

  const saveLocalAttendance = () => {
    try {
      localStorage.setItem(
        `attendance_${profile?.department_id}`,
        JSON.stringify(localAttendance),
      );
    } catch (e) {
      console.error("Failed to save local attendance:", e);
    }
  };

  const clearLocalAttendance = () => {
    localStorage.removeItem(`attendance_${profile?.department_id}`);
    setLocalAttendance([]);
    toast.success("Local attendance data cleared");
  };

  const fetchDepartmentName = async () => {
    try {
      const { data, error } = await supabase
        .from("departments")
        .select("name")
        .eq("id", profile!.department_id!)
        .single();

      if (error) throw error;
      if (data) setDepartmentName(data.name);
    } catch (error) {
      console.error("Error fetching department:", error);
      setDepartmentName("Unknown Department");
    }
  };

  const fetchCourses = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from("courses")
        .select("*")
        .eq("department_id", profile!.department_id!)
        .order("name");

      if (error) throw error;

      if (data && data.length > 0) {
        setCourses(data as DepartmentCourse[]);
        if (!selectedCourse) {
          setSelectedCourse(data[0].id);
        }
      } else {
        const { data: newCourse, error: createError } = await (supabase as any)
          .from("courses")
          .insert({
            name: "General Attendance",
            code: "GEN001",
            department_id: profile!.department_id,
          })
          .select()
          .single();

        if (createError) throw createError;
        if (newCourse) {
          setCourses([newCourse]);
          setSelectedCourse(newCourse.id);
          toast.success("Created default course");
        }
      }
    } catch (error: any) {
      console.error("Error fetching courses:", error);
      toast.error(`Failed to load courses: ${error.message}`);
    }
  };

  const fetchStudents = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from("students")
        .select("id, name, gender, matric_no, department_id")
        .eq("department_id", profile!.department_id!)
        .order("name");

      if (error) throw error;
      if (data) setStudents(data as Student[]);
    } catch (error: any) {
      console.error("Error fetching students:", error);
      toast.error(`Failed to load students: ${error.message}`);
    }
  };

  const fetchHistory = async () => {
    try {
      let allData: AttendanceRecord[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await (supabase as any)
          .from("attendance")
          .select(
            `
              id,
              student_ref,
              course_id,
              date,
              status,
              students:student_ref (
                name,
                matric_no,
                gender
              ),
              courses:course_id (
                name,
                code
              )
            `,
          )
          .eq("department_id", profile!.department_id!)
          .order("date", { ascending: false })
          .range(from, from + pageSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allData = [...allData, ...(data as AttendanceRecord[])];
          from += pageSize;
          hasMore = data.length === pageSize;
        } else {
          hasMore = false;
        }
      }

      setHistory(allData);
    } catch (error: any) {
      console.error("Error fetching history:", error);
      toast.error(`Failed to load history: ${error.message}`);
    }
  };

  const fetchAttendanceGrid = async () => {
    if (!profile?.department_id) return;
    if (!selectedCourse) {
      setGrid({});
      return;
    }

    try {
      const { data, error } = await supabase
        .from("attendance")
        .select("student_ref, date, status, course_id")
        .eq("department_id", profile.department_id)
        .eq("course_id", selectedCourse);

      if (error) throw error;

      if (!data) return;

      const newGrid: any = {};
      data.forEach((r: any) => {
        const val = r.status === "present" ? "P" : "A";
        if (!newGrid[r.student_ref]) newGrid[r.student_ref] = {};
        newGrid[r.student_ref][r.date] = val;
      });

      const unsynced = localAttendance.filter(
        (item) => !item.synced && item.courseId === selectedCourse,
      );
      unsynced.forEach((item) => {
        if (!newGrid[item.studentId]) newGrid[item.studentId] = {};
        newGrid[item.studentId][item.date] = item.status;
      });

      setGrid(newGrid);
    } catch (error: any) {
      console.error("Error fetching attendance grid:", error);
    }
  };

  const addCourse = async () => {
    if (!newCourse.name.trim() || !newCourse.code.trim()) {
      toast.error("Course name and code are required");
      return;
    }
    if (!profile?.department_id) return;
    setAddingCourse(true);

    try {
      const { error } = await (supabase as any).from("courses").insert({
        name: newCourse.name.trim(),
        code: newCourse.code.trim().toUpperCase(),
        department_id: profile.department_id,
      });

      if (error) throw error;

      toast.success("Course added successfully");
      setNewCourse({ name: "", code: "" });
      setShowCourseDialog(false);
      await fetchCourses();
    } catch (error: any) {
      console.error("Error adding course:", error);
      toast.error(`Failed to add course: ${error.message}`);
    } finally {
      setAddingCourse(false);
    }
  };

  const addDateColumn = () => {
    const newDate = new Date().toISOString().split("T")[0];
    if (!dateColumns.includes(newDate)) {
      setDateColumns((prev) => [...prev, newDate]);
    } else {
      let d = new Date();
      while (dateColumns.includes(d.toISOString().split("T")[0])) {
        d.setDate(d.getDate() + 1);
      }
      setDateColumns((prev) => [...prev, d.toISOString().split("T")[0]]);
    }
  };

  const updateDateColumn = (index: number, value: string) => {
    setDateColumns((prev) => prev.map((d, i) => (i === index ? value : d)));
  };

  const removeDateColumn = (index: number) => {
    if (dateColumns.length <= 1) return;
    const dateToRemove = dateColumns[index];
    setDateColumns((prev) => prev.filter((_, i) => i !== index));
    setGrid((prev) => {
      const next = { ...prev };
      for (const sid of Object.keys(next)) {
        const { [dateToRemove]: _, ...rest } = next[sid];
        next[sid] = rest;
      }
      return next;
    });
    setLocalAttendance((prev) =>
      prev.filter((item) => item.date !== dateToRemove),
    );
  };

  const toggleCell = (studentId: string, date: string) => {
    setGrid((prev) => {
      const current = prev[studentId]?.[date] || "";
      const nextStatus = current === "" ? "P" : current === "P" ? "A" : "";

      setLocalAttendance((prevLocal) => {
        const existing = prevLocal.find(
          (item) => item.studentId === studentId && item.date === date,
        );
        if (existing) {
          if (nextStatus === "") {
            return prevLocal.filter(
              (item) => !(item.studentId === studentId && item.date === date),
            );
          } else {
            return prevLocal.map((item) =>
              item.studentId === studentId && item.date === date
                ? {
                    ...item,
                    status: nextStatus,
                    synced: false,
                    error: undefined,
                    courseId: selectedCourse,
                  }
                : item,
            );
          }
        } else if (nextStatus !== "") {
          return [
            ...prevLocal,
            {
              studentId,
              courseId: selectedCourse,
              date,
              status: nextStatus,
              synced: false,
            },
          ];
        }
        return prevLocal;
      });

      return {
        ...prev,
        [studentId]: { ...prev[studentId], [date]: nextStatus },
      };
    });
  };

  const markAllForDate = (date: string, status: "P" | "A") => {
    setGrid((prev) => {
      const next = { ...prev };
      for (const student of students) {
        if (next[student.id]) {
          next[student.id][date] = status;
        } else {
          next[student.id] = { [date]: status };
        }

        setLocalAttendance((prevLocal) => {
          const existing = prevLocal.find(
            (item) => item.studentId === student.id && item.date === date,
          );
          if (existing) {
            return prevLocal.map((item) =>
              item.studentId === student.id && item.date === date
                ? {
                    ...item,
                    status,
                    synced: false,
                    error: undefined,
                    courseId: selectedCourse,
                  }
                : item,
            );
          } else {
            return [
              ...prevLocal,
              {
                studentId: student.id,
                courseId: selectedCourse,
                date,
                status,
                synced: false,
              },
            ];
          }
        });
      }
      return next;
    });

    toast.info(
      `Marked all students as ${status === "P" ? "Present" : "Absent"} for ${date}`,
    );
  };

  const syncAttendanceToDatabase = async () => {
    if (connectionStatus === "offline") {
      toast.error(
        "You are offline. Please check your internet connection and try again.",
      );
      return;
    }

    if (!profile?.department_id || !user?.id) {
      toast.error("Missing department or user information");
      return;
    }

    const unsynced = localAttendance.filter((item) => !item.synced);
    if (unsynced.length === 0) {
      toast.info("No unsynced attendance records to save");
      return;
    }

    setSyncingAttendance(true);

    let successCount = 0;
    let errorCount = 0;

    try {
      // Build rows for a single batched upsert (fast: 1 round-trip instead of 2N)
      const rows = unsynced.map((item) => ({
        student_ref: item.studentId,
        course_id: item.courseId,
        department_id: profile.department_id,
        marked_by: user.id,
        date: item.date,
        status: item.status === "P" ? "present" : "absent",
      }));

      // Chunk to avoid payload limits on very large saves
      const chunkSize = 500;
      const chunks: (typeof rows)[] = [];
      for (let i = 0; i < rows.length; i += chunkSize) {
        chunks.push(rows.slice(i, i + chunkSize));
      }

      const results = await Promise.all(
        chunks.map((chunk) =>
          (supabase as any)
            .from("attendance")
            .upsert(chunk, { onConflict: "student_ref,course_id,date" }),
        ),
      );

      results.forEach((res, idx) => {
        if (res.error) {
          console.error("Upsert error:", res.error);
          errorCount += chunks[idx].length;
        } else {
          successCount += chunks[idx].length;
        }
      });

      if (successCount > 0) {
        setLocalAttendance((prev) =>
          prev.map((item) => {
            const wasSynced = unsynced.some(
              (u) =>
                u.studentId === item.studentId &&
                u.date === item.date &&
                u.courseId === item.courseId,
            );
            return wasSynced
              ? { ...item, synced: true, error: undefined }
              : item;
          }),
        );

        toast.success(
          `Saved ${successCount} attendance record${successCount !== 1 ? "s" : ""}`,
        );
        // Refresh in parallel + don't block the UI
        void Promise.all([fetchAttendanceGrid(), fetchHistory()]);
      }

      if (errorCount > 0) {
        toast.error(
          `Failed to sync ${errorCount} record${errorCount !== 1 ? "s" : ""}. Please try again.`,
        );
      }
    } catch (error: any) {
      console.error("Sync error:", error);
      toast.error(`Sync failed: ${error.message || "Unknown error"}`);

      setLocalAttendance((prev) =>
        prev.map((item) => {
          const wasUnsynced = unsynced.some(
            (u) => u.studentId === item.studentId && u.date === item.date,
          );
          return wasUnsynced ? { ...item, error: error.message } : item;
        }),
      );
    } finally {
      setSyncingAttendance(false);
    }
  };

  const pushToGoogleSheets = async (action: "sync_unsynced" | "export_all") => {
    setSheetsBusy(action === "export_all" ? "export" : "sync");
    try {
      const { data, error } = await supabase.functions.invoke("sheets-sync", {
        body: { action },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Unknown error");
      if (data.synced > 0) {
        toast.success(
          `Synced ${data.synced} record${data.synced !== 1 ? "s" : ""} to Google Sheets`,
          {
            description: data.spreadsheetUrl ? "Open spreadsheet" : undefined,
            action: data.spreadsheetUrl
              ? {
                  label: "Open",
                  onClick: () => window.open(data.spreadsheetUrl, "_blank"),
                }
              : undefined,
          },
        );
      } else {
        toast.info(data.message || "Nothing new to sync");
      }
      await fetchHistory();
    } catch (err: any) {
      console.error("Google Sheets sync failed:", err);
      toast.error(
        `Google Sheets sync failed: ${err.message || "Unknown error"}`,
      );
    } finally {
      setSheetsBusy(false);
    }
  };

  const saveAttendance = async () => {
    await syncAttendanceToDatabase();
    // Fire-and-forget Google Sheets push so the UI unblocks immediately.
    // Sheets sync can take several seconds; we don't make the user wait.
    void pushToGoogleSheets("sync_unsynced").catch((err) => {
      console.warn("Sheets background sync failed (non-blocking):", err);
    });
  };

  const exportCSV = () => {
    if (students.length === 0) {
      toast.error("No students to export");
      return;
    }

    const currentCourse = courses.find((c) => c.id === selectedCourse);
    const headers = [
      "S/N",
      "Name",
      "Gender",
      "Matric No",
      "Department",
      "Course",
      ...dateColumns,
    ];
    const rows = students.map((s, i) => {
      const cells = [
        String(i + 1),
        s.name,
        s.gender || "",
        s.matric_no || "",
        departmentName,
        currentCourse?.name || "All Courses",
        ...dateColumns.map((d) => grid[s.id]?.[d] || ""),
      ];
      return cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
    });

    const csv = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance_${departmentName}_${currentCourse?.code || "all"}_${dateColumns[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported successfully");
  };

  const exportExcel = () => {
    if (students.length === 0) {
      toast.error("No students to export");
      return;
    }

    const currentCourse = courses.find((c) => c.id === selectedCourse);
    const data = students.map((s, i) => {
      const row: any = {
        "S/N": i + 1,
        Name: s.name,
        Gender: s.gender || "",
        "Matric No": s.matric_no || "",
        Department: departmentName,
        Course: currentCourse?.name || "All Courses",
      };

      dateColumns.forEach((d) => {
        const value = grid[s.id]?.[d] || "";
        row[d] = value === "P" ? "Present" : value === "A" ? "Absent" : "";
      });

      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const cols = Object.keys(data[0]).map((key) => ({
      wch:
        Math.max(
          key.length,
          ...data.map((row) => String(row[key] || "").length),
        ) + 2,
    }));
    worksheet["!cols"] = cols;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance");
    XLSX.writeFile(
      workbook,
      `attendance_${departmentName}_${currentCourse?.code || "all"}.xlsx`,
    );
    toast.success("Excel exported successfully");
  };

  const generatePDF = (): jsPDF => {
    const doc = new jsPDF();
    const currentCourse = courses.find((c) => c.id === selectedCourse);

    doc.setFontSize(16);
    doc.text("ATTENDANCE REPORT", 105, 15, { align: "center" });

    doc.setFontSize(12);
    doc.text(`Department: ${departmentName}`, 14, 25);
    doc.text(
      `Course: ${currentCourse ? `${currentCourse.code} - ${currentCourse.name}` : "All Courses"}`,
      14,
      32,
    );
    doc.text(`Date Generated: ${new Date().toLocaleDateString()}`, 14, 39);

    const filteredHistory = selectedCourse
      ? history.filter((r) => r.course_id === selectedCourse)
      : history;

    const tableData = filteredHistory.map((a, i) => [
      i + 1,
      a.students?.name ?? "Unknown",
      a.students?.matric_no ?? "-",
      a.students?.gender ?? "-",
      a.courses?.name ?? "-",
      a.date,
      a.status,
    ]);

    autoTable(doc, {
      startY: 48,
      head: [
        [
          "S/N",
          "Student Name",
          "Matric No",
          "Gender",
          "Course",
          "Date",
          "Status",
        ],
      ],
      body: tableData,
      styles: { fontSize: 10, cellPadding: 3 },
      headStyles: { fillColor: [22, 160, 133], textColor: 255 },
      alternateRowStyles: { fillColor: [240, 240, 240] },
      didParseCell: function (data) {
        if (data.column.index === 6) {
          if (data.cell.raw === "present")
            data.cell.styles.textColor = [0, 150, 0];
          if (data.cell.raw === "absent")
            data.cell.styles.textColor = [200, 0, 0];
        }
      },
    });

    const pageCount = doc.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.saveGraphicsState();
      doc.setFontSize(60);
      doc.setTextColor(200, 200, 200);
      doc.setGState(new (doc as any).GState({ opacity: 0.4 }));
      doc.text("Attendtrack", pageWidth / 2, pageHeight / 2, {
        align: "center",
        angle: 45,
      });
      doc.restoreGraphicsState();
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.text(`Page ${i} of ${pageCount}`, 105, 290, { align: "center" });
    }

    return doc;
  };

  const sharePDF = async () => {
    const filteredHistory = selectedCourse
      ? history.filter((r) => r.course_id === selectedCourse)
      : history;

    if (filteredHistory.length === 0) {
      toast.error("No attendance history to share");
      return;
    }

    try {
      const doc = generatePDF();
      const pdfBlob = doc.output("blob");
      const currentCourse = courses.find((c) => c.id === selectedCourse);
      const fileName = `attendance_${departmentName}_${currentCourse?.code || "all"}.pdf`;
      const message = `Attendance report for ${departmentName}${currentCourse ? ` - ${currentCourse.name}` : ""}`;

      pdfBlobRef.current = pdfBlob;
      setShareFileName(fileName);
      setShareMessage(message);
      setShowShareDialog(true);
    } catch (error: any) {
      console.error("Share error:", error);
      toast.error("Failed to prepare PDF");
    }
  };

  const downloadPDF = () => {
    if (!pdfBlobRef.current) return;
    const url = URL.createObjectURL(pdfBlobRef.current);
    const a = document.createElement("a");
    a.href = url;
    a.download = shareFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("PDF downloaded");
  };

  const shareViaNative = async () => {
    if (!pdfBlobRef.current) return;
    try {
      const file = new File([pdfBlobRef.current], shareFileName, {
        type: "application/pdf",
      });
      const shareData: any = {
        title: "Attendance Report",
        text: shareMessage,
        files: [file],
      };
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare(shareData)
      ) {
        await navigator.share(shareData);
        toast.success("Shared successfully");
        setShowShareDialog(false);
      } else {
        toast.error(
          "Native sharing not supported here. Please download and share manually.",
        );
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.warn("Native share failed:", err);
      toast.error(
        "Native share blocked. Please download the PDF and share manually.",
      );
    }
  };

  const shareViaWhatsApp = () => {
    downloadPDF();
    window.open(
      `https://wa.me/?text=${encodeURIComponent(shareMessage + " (PDF downloaded — please attach it)")}`,
      "_blank",
    );
  };

  const shareViaTelegram = () => {
    downloadPDF();
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(shareMessage)}&text=${encodeURIComponent(shareMessage)}`,
      "_blank",
    );
  };

  const shareViaEmail = () => {
    downloadPDF();
    window.location.href = `mailto:?subject=${encodeURIComponent("Attendance Report")}&body=${encodeURIComponent(shareMessage + "\n\nPlease find the attached PDF (downloaded to your device).")}`;
  };

  const updateStudentField = (id: string, field: string, value: string) => {
    setStudentEdits((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const saveStudentDetails = async () => {
    setSavingStudents(true);
    const editEntries = Object.entries(studentEdits);
    if (editEntries.length === 0) {
      toast.info("No changes to save");
      setSavingStudents(false);
      return;
    }

    let hasError = false;
    for (const [id, edits] of editEntries) {
      const { error } = await (supabase as any)
        .from("students")
        .update(edits)
        .eq("id", id);
      if (error) {
        toast.error(`Failed to update student: ${error.message}`);
        hasError = true;
        break;
      }
    }

    if (!hasError) {
      toast.success("Student details saved successfully");
      setStudentEdits({});
      fetchStudents();
    }
    setSavingStudents(false);
  };

  const addStudent = async () => {
    if (!newStudent.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!profile?.department_id) return;
    setAddingStudent(true);

    try {
      const { error } = await (supabase as any).from("students").insert({
        name: newStudent.name.trim(),
        gender: newStudent.gender || null,
        matric_no: newStudent.matric_no.trim() || null,
        department_id: profile.department_id,
      });

      if (error) throw error;

      toast.success("Student added successfully");
      setNewStudent({ name: "", gender: "", matric_no: "" });
      setShowAddDialog(false);
      await fetchStudents();
    } catch (error: any) {
      toast.error(`Failed to add student: ${error.message}`);
    } finally {
      setAddingStudent(false);
    }
  };

  const deleteStudent = async (id: string, name: string) => {
    if (
      !confirm(
        `Delete student "${name}"? This will also delete their attendance records. This cannot be undone.`,
      )
    )
      return;

    try {
      const { error } = await (supabase as any)
        .from("students")
        .delete()
        .eq("id", id);
      if (error) throw error;

      toast.success("Student deleted successfully");
      await fetchStudents();
    } catch (error: any) {
      toast.error(`Failed to delete student: ${error.message}`);
    }
  };

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile?.department_id) return;

    setImporting(true);
    try {
      const text = await file.text();
      const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length < 2) {
        toast.error("CSV must have a header row and at least one data row");
        setImporting(false);
        return;
      }

      const headers = lines[0]
        .toLowerCase()
        .split(",")
        .map((h) => h.trim());
      const nameIdx = headers.findIndex((h) => h === "name");
      const genderIdx = headers.findIndex((h) => h === "gender");
      const matricIdx = headers.findIndex((h) => h.includes("matric"));

      if (nameIdx === -1) {
        toast.error('CSV must have a "name" column');
        setImporting(false);
        return;
      }

      const csvRows = lines
        .slice(1)
        .map((line) => {
          const cols = line.split(",").map((c) => c.trim());
          return {
            name: cols[nameIdx] || "",
            gender: genderIdx >= 0 ? cols[genderIdx] || null : null,
            matric_no: matricIdx >= 0 ? cols[matricIdx] || null : null,
            department_id: profile.department_id!,
          };
        })
        .filter((s) => s.name);

      if (csvRows.length === 0) {
        toast.error("No valid students found in CSV");
        setImporting(false);
        return;
      }

      const { error } = await (supabase as any)
        .from("students")
        .insert(csvRows);
      if (error) throw error;

      toast.success(`Successfully imported ${csvRows.length} students`);
      await fetchStudents();
    } catch (error: any) {
      toast.error(`Import failed: ${error.message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteAllHistory = async () => {
    if (
      !confirm(
        "⚠️ WARNING: This will delete ALL attendance history for your department. This action cannot be undone. Are you absolutely sure?",
      )
    )
      return;
    if (!profile?.department_id) return;

    setDeletingHistory(true);
    try {
      const { error } = await (supabase as any)
        .from("attendance")
        .delete()
        .eq("department_id", profile.department_id);

      if (error) throw error;

      toast.success("All attendance history deleted");
      setHistory([]);
      setGrid({});
      clearLocalAttendance();
    } catch (error: any) {
      toast.error(`Failed to delete history: ${error.message}`);
    } finally {
      setDeletingHistory(false);
    }
  };

  const studentStats = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7);
    const filteredHistoryForStats =
      historyCourseFilter !== "all"
        ? history.filter((r) => r.course_id === historyCourseFilter)
        : history;

    return students.map((student) => {
      const records = filteredHistoryForStats.filter(
        (r) => r.student_ref === student.id && r.date.startsWith(month),
      );
      const total = records.length;
      const present = records.filter((r) => r.status === "present").length;
      const percent = total ? (present / total) * 100 : 0;
      return { ...student, present, total, percent };
    });
  }, [students, history, historyCourseFilter]);

  const filteredStats = useMemo(() => {
    let result = studentStats;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.matric_no && s.matric_no.toLowerCase().includes(q)),
      );
    }
    if (filterPercent === "below75") {
      result = result.filter((s) => s.percent < 75);
    } else if (filterPercent === "above75") {
      result = result.filter((s) => s.percent >= 75);
    }
    return result;
  }, [studentStats, searchQuery, filterPercent]);

  const filteredHistory = useMemo(() => {
    if (historyCourseFilter === "all") return history;
    return history.filter((r) => r.course_id === historyCourseFilter);
  }, [history, historyCourseFilter]);

  const pendingSyncCount = localAttendance.filter(
    (item) => !item.synced,
  ).length;
  const failedSyncCount = localAttendance.filter(
    (item) => item.error && !item.synced,
  ).length;

  if (!profile?.department_id) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md">
            <CardContent className="pt-6 text-center">
              <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
              <p className="text-muted-foreground">
                You haven't been assigned to a department yet.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Please contact a super administrator to assign you to a
                department.
              </p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const statusStyles: Record<string, string> = {
    present:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    absent: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };

  const cellStyles: Record<string, string> = {
    P: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    A: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    "": "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  };

  const tabs = [
    { id: "mark" as const, label: "Mark Attendance", icon: CalendarCheck },
    { id: "students" as const, label: "Students", icon: Users },
    { id: "history" as const, label: "History", icon: History },
    { id: "logins" as const, label: "Login Log", icon: ShieldCheck },
  ];

  const fetchLoginEvents = async () => {
    setLoginEventsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("student_login_events")
        .select("id, created_at, event, matric_no, student_id, detail")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setLoginEvents(data ?? []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load login events");
    } finally {
      setLoginEventsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "logins") fetchLoginEvents();
  }, [activeTab]);

  const fetchSheetHistory = async () => {
    setSheetHistoryLoading(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke(
        "sheets-sync",
        {
          body: { action: "read_all" },
        },
      );
      if (error) throw error;
      if (!data?.ok)
        throw new Error(data?.error || "Failed to read Google Sheet");
      setSheetUrl(data.spreadsheetUrl ?? null);
      const rows: AttendanceRecord[] = (data.rows ?? []).map(
        (r: any, i: number) =>
          ({
            id: r.attendance_id || `sheet-${i}`,
            student_ref: "",
            course_id: "",
            date: r.date,
            status: (r.status || "").toLowerCase(),
            students: {
              name: r.student_name,
              matric_no: r.matric_no,
              gender: r.gender,
            },
            courses: { name: r.course_name, code: r.course_code },
          }) as AttendanceRecord,
      );
      // newest first by date
      rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      setSheetHistory(rows);
    } catch (e: any) {
      console.error("sheet history error", e);
      toast.error(e?.message || "Failed to load Google Sheet history");
    } finally {
      setSheetHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (
      activeTab === "history" &&
      historySource === "sheet" &&
      sheetHistory.length === 0 &&
      !sheetHistoryLoading
    ) {
      fetchSheetHistory();
    }
  }, [activeTab, historySource]);

  // Live QR session helpers
  const createQrSession = async () => {
    if (!qrCourseId) {
      toast.error("Pick a course first");
      return;
    }
    if (!profile?.department_id || !user) {
      toast.error("Missing profile");
      return;
    }
    if (qrLat == null || qrLng == null) {
      toast.error("Pick the class location on the map");
      return;
    }
    setQrCreating(true);
    try {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(18)))
        .map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36])
        .join("");
      const expires_at = new Date(
        Date.now() + qrDurationMin * 60_000,
      ).toISOString();
      const { data, error } = await (supabase as any)
        .from("attendance_sessions")
        .insert({
          course_id: qrCourseId,
          department_id: profile.department_id,
          date: qrDate,
          token,
          expires_at,
          created_by: user.id,
          latitude: qrLat,
          longitude: qrLng,
          radius_m: qrRadius,
        })
        .select("token, expires_at, course_id, date")
        .single();
      if (error) throw error;
      setQrSession(data);
      toast.success("Live session started");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to start session");
    } finally {
      setQrCreating(false);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation not supported");
      return;
    }
    toast.message("Getting your location...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setQrLat(pos.coords.latitude);
        setQrLng(pos.coords.longitude);
        toast.success("Location captured");
      },
      (err) => toast.error("Location failed: " + err.message),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const endQrSession = async () => {
    if (!qrSession) return;
    await (supabase as any)
      .from("attendance_sessions")
      .update({ expires_at: new Date().toISOString() })
      .eq("token", qrSession.token);
    setQrSession(null);
    toast.message("Session ended");
  };

  const endAndMarkAbsent = async () => {
    if (!qrSession) return;
    setQrEnding(true);
    try {
      const { data, error } = await supabase.functions.invoke("end-session", {
        body: { token: qrSession.token },
      });
      if (error || (data as any)?.error)
        throw new Error((data as any)?.error || error?.message);
      toast.success(
        `Session ended. ${(data as any)?.marked_absent ?? 0} student(s) marked absent.`,
      );
      setQrSession(null);
      fetchHistory();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to end session");
    } finally {
      setQrEnding(false);
    }
  };

  const provisionStudentLogins = async () => {
    setProvisioningAuth(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "provision-student-auth",
        { body: {} },
      );
      if (error || (data as any)?.error)
        throw new Error((data as any)?.error || error?.message);
      const created =
        (data as any)?.results?.filter((r: any) => r.status === "created")
          .length ?? 0;
      const existing =
        (data as any)?.results?.filter(
          (r: any) => r.status === "already_provisioned",
        ).length ?? 0;
      const failed =
        (data as any)?.results?.filter((r: any) => r.error || r.skipped)
          .length ?? 0;
      toast.success(
        `Provisioned ${created} new, ${existing} already had logins${failed ? `, ${failed} skipped/failed` : ""}.`,
      );
    } catch (e: any) {
      toast.error(e.message ?? "Failed to provision logins");
    } finally {
      setProvisioningAuth(false);
    }
  };

  const [resettingLogins, setResettingLogins] = useState(false);
  const resetStudentLogins = async () => {
    if (
      !confirm(
        "Reset one-time login lock for ALL students in your department? They will be able to sign in again once.",
      )
    )
      return;
    setResettingLogins(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "provision-student-auth",
        { body: { action: "reset_login" } },
      );
      if (error || (data as any)?.error)
        throw new Error((data as any)?.error || error?.message);
      const n =
        (data as any)?.results?.filter((r: any) => r.status === "login_reset")
          .length ?? 0;
      toast.success(`Reset login lock for ${n} student(s).`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to reset logins");
    } finally {
      setResettingLogins(false);
    }
  };

  const [resettingStudentId, setResettingStudentId] = useState<string | null>(
    null,
  );
  const resetSingleStudentLogin = async (
    studentId: string,
    studentName: string,
  ) => {
    if (
      !confirm(
        `Reset one-time login lock for ${studentName}? They will be able to sign in again once.`,
      )
    )
      return;
    setResettingStudentId(studentId);
    try {
      const { data, error } = await supabase.functions.invoke(
        "provision-student-auth",
        {
          body: { action: "reset_login", student_id: studentId },
        },
      );
      if (error || (data as any)?.error)
        throw new Error((data as any)?.error || error?.message);
      toast.success(`Login lock reset for ${studentName}.`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to reset login");
    } finally {
      setResettingStudentId(null);
    }
  };

  if (initialLoading) {
    return <LoadingScreen message="Loading dashboard..." />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <DashboardHeader
          departmentName={departmentName}
          connectionStatus={connectionStatus}
        />

        <ProgressSummary department={departmentName} />

        <CourseSelector
          courses={courses}
          selectedCourse={selectedCourse}
          onSelectCourse={setSelectedCourse}
          open={showCourseDialog}
          onOpenChange={setShowCourseDialog}
          newCourse={newCourse}
          onNewCourseChange={setNewCourse}
          onAddCourse={() => void addCourse()}
          addingCourse={addingCourse}
        />

        <DepartmentToolbar
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onOpenQr={() => {
            setQrCourseId(selectedCourse || "");
            setShowQrDialog(true);
          }}
          onProvisionLogins={() => void provisionStudentLogins()}
          provisioningAuth={provisioningAuth}
          onResetLogins={() => void resetStudentLogins()}
          resettingLogins={resettingLogins}
          sheetsBusy={sheetsBusy}
          onExportSheets={() => void pushToGoogleSheets("export_all")}
          onSyncSheets={() => void pushToGoogleSheets("sync_unsynced")}
        />

        <Dialog
          open={showQrDialog}
          onOpenChange={(o) => {
            setShowQrDialog(o);
            if (!o) {
              setQrSession(null);
            }
          }}
        >
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Live QR Attendance Session</DialogTitle>
            </DialogHeader>
            {!qrSession ? (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-sm font-medium">Course</label>
                  <Select value={qrCourseId} onValueChange={setQrCourseId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a course" />
                    </SelectTrigger>
                    <SelectContent>
                      {courses.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.code} - {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Date</label>
                  <Input
                    type="date"
                    value={qrDate}
                    onChange={(e) => setQrDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Duration</label>
                  <Select
                    value={String(qrDurationMin)}
                    onValueChange={(v) => setQrDurationMin(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 minutes</SelectItem>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">
                      Class location (tap map to set)
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={useMyLocation}
                    >
                      Use my location
                    </Button>
                  </div>
                  <LocationPicker
                    lat={qrLat}
                    lng={qrLng}
                    radius={qrRadius}
                    onChange={(la, ln) => {
                      setQrLat(la);
                      setQrLng(ln);
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium whitespace-nowrap">
                      Radius (m)
                    </label>
                    <Input
                      type="number"
                      min={10}
                      max={5000}
                      value={qrRadius}
                      onChange={(e) =>
                        setQrRadius(Math.max(10, Number(e.target.value) || 100))
                      }
                    />
                  </div>
                  {qrLat != null && qrLng != null && (
                    <p className="text-xs text-muted-foreground">
                      Pin: {qrLat.toFixed(5)}, {qrLng.toFixed(5)} · radius{" "}
                      {qrRadius}m
                    </p>
                  )}
                </div>

                <Button
                  onClick={createQrSession}
                  disabled={qrCreating || !qrCourseId || qrLat == null}
                  className="w-full"
                >
                  {qrCreating ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <QrCode className="w-4 h-4 mr-2" />
                  )}
                  Start session
                </Button>
                <p className="text-xs text-muted-foreground">
                  Students must be within the radius of the pinned location to
                  mark attendance.
                </p>
              </div>
            ) : (
              (() => {
                const scanUrl = `${window.location.origin}/scan?token=${qrSession.token}${rotatingCode ? `&c=${rotatingCode}` : ""}`;
                const remainingMs =
                  new Date(qrSession.expires_at).getTime() - now;
                const remaining = Math.max(0, Math.floor(remainingMs / 1000));
                const mm = Math.floor(remaining / 60)
                  .toString()
                  .padStart(2, "0");
                const ss = (remaining % 60).toString().padStart(2, "0");
                const expired = remainingMs <= 0;
                const signed = history.filter(
                  (r) =>
                    r.course_id === qrSession.course_id &&
                    r.date === qrSession.date &&
                    r.status === "present",
                );

                return (
                  <div className="space-y-3 pt-2 text-center">
                    <div className="bg-white p-4 rounded-lg inline-block mx-auto">
                      <QRCodeCanvas value={scanUrl} size={240} includeMargin />
                    </div>

                    {rotatingCode && (
                      <p className="text-sm">
                        Rotating code:{" "}
                        <span className="font-mono font-bold tracking-widest">
                          {rotatingCode}
                        </span>
                      </p>
                    )}

                    <p className="text-2xl font-mono font-bold">
                      {expired ? "EXPIRED" : `${mm}:${ss}`}
                    </p>

                    <div className="text-sm">
                      <p className="font-semibold">
                        {signed.length} student{signed.length === 1 ? "" : "s"}{" "}
                        signed in
                      </p>
                      {signed.length > 0 && (
                        <p className="text-xs text-muted-foreground max-h-20 overflow-y-auto">
                          {signed
                            .map((r) => r.students?.name ?? "Unknown")
                            .join(", ")}
                        </p>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground break-all">
                      {scanUrl}
                    </p>

                    <div className="flex flex-wrap gap-2 justify-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard.writeText(scanUrl);
                          toast.success("Link copied");
                        }}
                      >
                        <Copy className="w-4 h-4 mr-1" /> Copy link
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={endQrSession}
                      >
                        End session
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={endAndMarkAbsent}
                        disabled={qrEnding}
                      >
                        {qrEnding ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <XCircle className="w-4 h-4 mr-1" />
                        )}
                        End & mark absent
                      </Button>
                    </div>
                  </div>
                );
              })()
            )}
          </DialogContent>
        </Dialog>

        {activeTab === "mark" && (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Mark Attendance</CardTitle>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Department: {departmentName}
                    {selectedCourse &&
                      courses.find((c) => c.id === selectedCourse) && (
                        <span className="ml-2 font-semibold">
                          | Course:{" "}
                          {courses.find((c) => c.id === selectedCourse)?.code} -{" "}
                          {courses.find((c) => c.id === selectedCourse)?.name}
                        </span>
                      )}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={addDateColumn}>
                    <Plus className="w-4 h-4 mr-1" /> Add Date
                  </Button>
                  <Button
                    variant="outline"
                    onClick={exportCSV}
                    disabled={students.length === 0}
                  >
                    <Download className="w-4 h-4 mr-1" /> Export CSV
                  </Button>
                  <Button
                    variant="outline"
                    onClick={exportExcel}
                    disabled={students.length === 0}
                  >
                    <Download className="w-4 h-4 mr-1" /> Excel
                  </Button>
                  {/* <SheetsActions
                    busy={sheetsBusy}
                    onExport={() => pushToGoogleSheets('export_all')}
                    onSync={() => pushToGoogleSheets('sync_unsynced')}
                  /> */}
                  <Button onClick={sharePDF} disabled={history.length === 0}>
                    <Download className="w-4 h-4 mr-1" /> Share PDF
                  </Button>
                  <Dialog
                    open={showShareDialog}
                    onOpenChange={setShowShareDialog}
                  >
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Share Attendance PDF</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-2 pt-2">
                        <p className="text-sm text-muted-foreground">
                          {shareFileName}
                        </p>
                        <Button className="w-full" onClick={downloadPDF}>
                          <Download className="w-4 h-4 mr-2" /> Download PDF
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={shareViaNative}
                        >
                          Share via device (if supported)
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={shareViaWhatsApp}
                        >
                          WhatsApp (downloads PDF + opens chat)
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={shareViaTelegram}
                        >
                          Telegram (downloads PDF + opens chat)
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={shareViaEmail}
                        >
                          Email (downloads PDF + opens mail)
                        </Button>
                        <p className="text-xs text-muted-foreground pt-2">
                          Tip: native sharing is blocked inside the preview
                          iframe. Open the published app on your phone for
                          one-tap sharing, or download here and attach manually.
                        </p>
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Button
                    onClick={saveAttendance}
                    disabled={
                      syncingAttendance ||
                      pendingSyncCount === 0 ||
                      connectionStatus === "offline"
                    }
                    variant={pendingSyncCount > 0 ? "default" : "outline"}
                  >
                    {syncingAttendance ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-1" />
                    )}
                    {syncingAttendance
                      ? "Syncing..."
                      : `Save All (${pendingSyncCount})`}
                  </Button>
                  {failedSyncCount > 0 && (
                    <Button
                      onClick={syncAttendanceToDatabase}
                      variant="destructive"
                      size="sm"
                    >
                      <RefreshCw className="w-4 h-4 mr-1" /> Retry Failed (
                      {failedSyncCount})
                    </Button>
                  )}
                </div>
              </div>

              {pendingSyncCount > 0 && (
                <Badge className="mt-2 bg-yellow-100 text-yellow-800">
                  <Database className="w-3 h-3 mr-1" />
                  {pendingSyncCount} unsynced record
                  {pendingSyncCount !== 1 ? "s" : ""}
                </Badge>
              )}

              {failedSyncCount > 0 && (
                <Badge className="mt-2 bg-red-100 text-red-800 ml-2">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {failedSyncCount} failed record
                  {failedSyncCount !== 1 ? "s" : ""}
                </Badge>
              )}

              {connectionStatus === "offline" && (
                <Badge className="mt-2 bg-red-100 text-red-800">
                  <WifiOff className="w-3 h-3 mr-1" />
                  You are offline. Changes will be saved locally and synced when
                  you reconnect.
                </Badge>
              )}

              <p className="text-xs text-muted-foreground mt-2">
                Click a cell to toggle: empty →{" "}
                <Check className="inline w-3 h-3 text-green-600" /> (Present) →{" "}
                <X className="inline w-3 h-3 text-red-600" /> (Absent) → empty
              </p>
              <p className="text-xs text-muted-foreground">
                Changes are saved locally and will be synced when you click
                "Save All"
              </p>
            </CardHeader>
            <CardContent>
              {students.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No students yet.</p>
                  <Button
                    variant="link"
                    onClick={() => setActiveTab("students")}
                    className="mt-2"
                  >
                    Go to Students tab to add some
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12 text-center">S/N</TableHead>
                        <TableHead className="min-w-[150px]">Name</TableHead>
                        <TableHead className="w-16 text-center">
                          Gender
                        </TableHead>
                        <TableHead className="min-w-[130px]">
                          Matric No
                        </TableHead>
                        <TableHead className="min-w-[120px]">
                          Department
                        </TableHead>
                        {dateColumns.map((date, i) => (
                          <TableHead
                            key={i}
                            className="text-center min-w-[110px]"
                          >
                            <div className="flex flex-col items-center gap-1">
                              <Input
                                type="date"
                                value={date}
                                onChange={(e) =>
                                  updateDateColumn(i, e.target.value)
                                }
                                className="h-7 text-xs w-[120px] px-1"
                              />
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => markAllForDate(date, "P")}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-300 dark:hover:bg-green-800 flex items-center gap-0.5"
                                  title="Mark all present"
                                >
                                  <CheckCheck className="w-3 h-3" /> All P
                                </button>
                                <button
                                  onClick={() => markAllForDate(date, "A")}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800 flex items-center gap-0.5"
                                  title="Mark all absent"
                                >
                                  <XCircle className="w-3 h-3" /> All A
                                </button>
                              </div>
                              {dateColumns.length > 1 && (
                                <button
                                  onClick={() => removeDateColumn(i)}
                                  className="text-[10px] text-destructive hover:underline"
                                >
                                  remove
                                </button>
                              )}
                            </div>
                          </TableHead>
                        ))}
                        <TableHead className="w-20 text-center">
                          Remark
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {students.map((student, idx) => (
                        <TableRow key={student.id}>
                          <TableCell className="text-center font-medium">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="font-medium">
                            {student.name}
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {student.gender ? student.gender.charAt(0) : ""}
                          </TableCell>
                          <TableCell className="text-sm">
                            {student.matric_no || ""}
                          </TableCell>
                          <TableCell className="text-sm">
                            {departmentName}
                          </TableCell>
                          {dateColumns.map((date, i) => {
                            const val = grid[student.id]?.[date] || "";
                            const isPending = localAttendance.some(
                              (item) =>
                                item.studentId === student.id &&
                                item.date === date &&
                                !item.synced,
                            );
                            const hasError = localAttendance.some(
                              (item) =>
                                item.studentId === student.id &&
                                item.date === date &&
                                item.error,
                            );
                            return (
                              <TableCell key={i} className="text-center p-1">
                                <button
                                  onClick={() => toggleCell(student.id, date)}
                                  className={`w-full h-8 rounded text-xs font-bold transition-colors flex items-center justify-center relative ${cellStyles[val]}`}
                                  disabled={
                                    connectionStatus === "offline" && !isPending
                                  }
                                >
                                  {val === "P" ? (
                                    <Check className="w-4 h-4" />
                                  ) : val === "A" ? (
                                    <X className="w-4 h-4" />
                                  ) : (
                                    "—"
                                  )}
                                  {isPending && !hasError && (
                                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></span>
                                  )}
                                  {hasError && (
                                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                                  )}
                                </button>
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-center text-sm text-muted-foreground">
                            —
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "students" && (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-lg">Student Details</CardTitle>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleCSVImport}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importing}
                  >
                    {importing ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 mr-1" />
                    )}
                    {importing ? "Importing..." : "Import CSV"}
                  </Button>
                  <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="w-4 h-4 mr-1" /> Add Student
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add New Student</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 pt-2">
                        <div>
                          <label className="text-sm font-medium">Name *</label>
                          <Input
                            value={newStudent.name}
                            onChange={(e) =>
                              setNewStudent((p) => ({
                                ...p,
                                name: e.target.value,
                              }))
                            }
                            placeholder="Full name"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium">Gender</label>
                          <Select
                            value={newStudent.gender}
                            onValueChange={(v) =>
                              setNewStudent((p) => ({ ...p, gender: v }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select gender" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Male">Male</SelectItem>
                              <SelectItem value="Female">Female</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-medium">
                            Matric No
                          </label>
                          <Input
                            value={newStudent.matric_no}
                            onChange={(e) =>
                              setNewStudent((p) => ({
                                ...p,
                                matric_no: e.target.value,
                              }))
                            }
                            placeholder="e.g., MAT/2024/001"
                          />
                        </div>
                        <Button
                          onClick={addStudent}
                          disabled={addingStudent}
                          className="w-full"
                        >
                          {addingStudent ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Plus className="w-4 h-4 mr-2" />
                          )}
                          {addingStudent ? "Adding..." : "Add Student"}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  {Object.keys(studentEdits).length > 0 && (
                    <Button
                      onClick={saveStudentDetails}
                      disabled={savingStudents}
                    >
                      {savingStudents ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-1" />
                      )}
                      Save Changes
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                CSV format: name, gender, matric_no (header row required)
              </p>
            </CardHeader>
            <CardContent>
              {students.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No students yet.</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Add them manually or import a CSV file.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Gender</TableHead>
                        <TableHead>Matric No</TableHead>
                        <TableHead className="w-16">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {students.map((student) => {
                        const edits = studentEdits[student.id] || {};
                        return (
                          <TableRow key={student.id}>
                            <TableCell>
                              <Input
                                value={edits.name ?? student.name}
                                onChange={(e) =>
                                  updateStudentField(
                                    student.id,
                                    "name",
                                    e.target.value,
                                  )
                                }
                                className="min-w-[140px]"
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={edits.gender ?? student.gender ?? ""}
                                onValueChange={(v) =>
                                  updateStudentField(student.id, "gender", v)
                                }
                              >
                                <SelectTrigger className="w-[120px]">
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Male">Male</SelectItem>
                                  <SelectItem value="Female">Female</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input
                                value={
                                  edits.matric_no ?? student.matric_no ?? ""
                                }
                                onChange={(e) =>
                                  updateStudentField(
                                    student.id,
                                    "matric_no",
                                    e.target.value,
                                  )
                                }
                                placeholder="e.g., MAT/2024/001"
                                className="min-w-[160px]"
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Reset one-time login lock"
                                  onClick={() =>
                                    resetSingleStudentLogin(
                                      student.id,
                                      student.name,
                                    )
                                  }
                                  disabled={resettingStudentId === student.id}
                                >
                                  {resettingStudentId === student.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <KeyRound className="w-4 h-4" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() =>
                                    deleteStudent(student.id, student.name)
                                  }
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "history" && (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Attendance History</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    {historySource === "sheet" ? (
                      <>
                        Source:{" "}
                        <span className="font-medium">
                          Google Sheet archive
                        </span>
                        {sheetUrl && (
                          <>
                            {" "}
                            ·{" "}
                            <a
                              href={sheetUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              Open sheet
                            </a>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        Source:{" "}
                        <span className="font-medium">Recent (live)</span> ·
                        updates automatically
                      </>
                    )}
                    {historySource === "sheet" ? (
                      <>
                        Source:{" "}
                        <span className="font-medium">Google Sheet</span>
                        {sheetUrl && (
                          <>
                            {" "}
                            ·{" "}
                            <a
                              href={sheetUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              Open sheet
                            </a>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        Source:{" "}
                        <span className="font-medium">Local database</span>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <Select
                    value={historySource}
                    onValueChange={(v: any) => setHistorySource(v)}
                  >
                    <SelectTrigger className="w-[170px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">Recent (live)</SelectItem>
                      <SelectItem value="sheet">
                        Archive (Google Sheet)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {historySource === "sheet" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={fetchSheetHistory}
                      disabled={sheetHistoryLoading}
                    >
                      {sheetHistoryLoading ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4 mr-1" />
                      )}
                      Refresh
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={deleteAllHistory}
                    disabled={deletingHistory || history.length === 0}
                  >
                    {deletingHistory ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-1" />
                    )}
                    {deletingHistory ? "Deleting..." : "Delete All History"}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 mt-3">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or matric no..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8"
                  />
                </div>
                <Select
                  value={historyCourseFilter}
                  onValueChange={setHistoryCourseFilter}
                >
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="Filter by course" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Courses</SelectItem>
                    {courses.map((course) => (
                      <SelectItem key={course.id} value={course.id}>
                        {course.code} - {course.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterPercent} onValueChange={setFilterPercent}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="Filter by %" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Students</SelectItem>
                    <SelectItem value="below75">Below 75%</SelectItem>
                    <SelectItem value="above75">75% and above</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                {filteredStats.slice(0, 12).map((student) => (
                  <div
                    key={student.id}
                    className="p-3 rounded-lg border bg-muted/30"
                  >
                    <p
                      className="font-medium text-sm truncate"
                      title={student.name}
                    >
                      {student.name}
                    </p>
                    {student.matric_no && (
                      <p className="text-xs text-muted-foreground">
                        {student.matric_no}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Present: {student.present} / {student.total}
                    </p>
                    <p
                      className={`text-sm font-bold mt-1 ${student.percent >= 75 ? "text-green-600" : "text-red-500"}`}
                    >
                      {student.percent.toFixed(1)}%
                    </p>
                  </div>
                ))}
                {filteredStats.length === 0 && (
                  <p className="text-muted-foreground text-sm col-span-full text-center py-4">
                    No students match your search/filter.
                  </p>
                )}
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center">S/N</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Matric No</TableHead>
                      <TableHead>Gender</TableHead>
                      <TableHead>Course</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const source =
                        historySource === "sheet"
                          ? sheetHistory
                          : filteredHistory;
                      const selectedCourseCode =
                        historyCourseFilter !== "all"
                          ? courses.find((c) => c.id === historyCourseFilter)
                              ?.code
                          : null;
                      const filtered = source.filter((r) => {
                        if (historyCourseFilter !== "all") {
                          if (historySource === "sheet") {
                            if (r.courses?.code !== selectedCourseCode)
                              return false;
                          } else {
                            if (r.course_id !== historyCourseFilter)
                              return false;
                          }
                        }
                        if (!searchQuery.trim()) return true;
                        const q = searchQuery.toLowerCase();
                        return (
                          r.students?.name?.toLowerCase().includes(q) ||
                          r.students?.matric_no?.toLowerCase().includes(q)
                        );
                      });
                      if (filtered.length === 0) {
                        return (
                          <TableRow>
                            <TableCell
                              colSpan={7}
                              className="text-center text-muted-foreground py-8"
                            >
                              {historySource === "sheet"
                                ? sheetHistoryLoading
                                  ? "Loading from Google Sheet..."
                                  : "No records found in the Google Sheet for the selected course."
                                : historyCourseFilter !== "all"
                                  ? "No attendance records for the selected course."
                                  : "No attendance records yet. Start marking attendance!"}
                            </TableCell>
                          </TableRow>
                        );
                      }
                      return filtered.slice(0, 100).map((r, idx) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-center font-medium">
                            {idx + 1}
                          </TableCell>
                          <TableCell
                            className="max-w-[200px] truncate"
                            title={r.students?.name ?? "Unknown"}
                          >
                            {r.students?.name ?? "Unknown"}
                          </TableCell>
                          <TableCell>{r.students?.matric_no ?? "-"}</TableCell>
                          <TableCell>{r.students?.gender ?? "-"}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {r.courses?.code || "-"}
                            </Badge>
                          </TableCell>
                          <TableCell>{r.date}</TableCell>
                          <TableCell>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusStyles[r.status] || "bg-muted"}`}
                            >
                              {r.status}
                            </span>
                          </TableCell>
                        </TableRow>
                      ));
                    })()}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === "logins" && (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" /> Student Login Audit Log
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fetchLoginEvents}
                  disabled={loginEventsLoading}
                >
                  {loginEventsLoading ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-1" />
                  )}
                  Refresh
                </Button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 mt-3">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by matric no or name..."
                    value={loginEventSearch}
                    onChange={(e) => setLoginEventSearch(e.target.value)}
                    className="pl-8"
                  />
                </div>
                <Select
                  value={loginEventFilter}
                  onValueChange={(v: any) => setLoginEventFilter(v)}
                >
                  <SelectTrigger className="w-full sm:w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All events</SelectItem>
                    <SelectItem value="success">Successful logins</SelectItem>
                    <SelectItem value="blocked_already_used">
                      Blocked (already used)
                    </SelectItem>
                    <SelectItem value="reset">Admin resets</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center">S/N</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Matric No</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const q = loginEventSearch.trim().toLowerCase();
                      const rows = loginEvents.filter((ev) => {
                        if (
                          loginEventFilter !== "all" &&
                          ev.event !== loginEventFilter
                        )
                          return false;
                        if (!q) return true;
                        const stu = students.find(
                          (s) => s.id === ev.student_id,
                        );
                        return (
                          ev.matric_no?.toLowerCase().includes(q) ||
                          stu?.name?.toLowerCase().includes(q)
                        );
                      });
                      if (rows.length === 0) {
                        return (
                          <TableRow>
                            <TableCell
                              colSpan={6}
                              className="text-center text-muted-foreground py-8"
                            >
                              {loginEventsLoading
                                ? "Loading..."
                                : "No login events yet."}
                            </TableCell>
                          </TableRow>
                        );
                      }
                      const styles: Record<string, string> = {
                        success: "bg-green-100 text-green-700",
                        blocked_already_used: "bg-red-100 text-red-700",
                        reset: "bg-amber-100 text-amber-700",
                      };
                      const labels: Record<string, string> = {
                        success: "Signed in",
                        blocked_already_used: "Blocked",
                        reset: "Admin reset",
                      };
                      return rows.map((ev, idx) => {
                        const stu = students.find(
                          (s) => s.id === ev.student_id,
                        );
                        return (
                          <TableRow key={ev.id}>
                            <TableCell className="text-center font-medium">
                              {idx + 1}
                            </TableCell>
                            <TableCell
                              className="max-w-[200px] truncate"
                              title={stu?.name ?? "—"}
                            >
                              {stu?.name ?? "—"}
                            </TableCell>
                            <TableCell>{ev.matric_no ?? "—"}</TableCell>
                            <TableCell>
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[ev.event] || "bg-muted"}`}
                              >
                                {labels[ev.event] || ev.event}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm whitespace-nowrap">
                              {new Date(ev.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {ev.event === "blocked_already_used" &&
                              ev.detail?.first_login_at
                                ? `First login: ${new Date(ev.detail.first_login_at).toLocaleString()}`
                                : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      });
                    })()}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
};

export default DeptAdminDashboard;
