import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { 
  CalendarCheck, Download, History, Users, Plus, Upload, Save, Trash2, 
  Check, X, CheckCheck, XCircle, Search, Database, BookOpen, AlertCircle, 
  RefreshCw, WifiOff, Loader2, QrCode, KeyRound, Copy
} from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import { SheetsActions } from '@/components/SheetsActions';
import { SheetsSettingsDialog } from '@/components/SheetsSettingsDialog';
import { ProgressSummary } from '@/components/ProgressSummary';
import LoadingScreen from '@/components/LoadingScreen';
import { QRCodeCanvas } from 'qrcode.react';
import * as XLSX from "xlsx";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Student {
  id: string;
  name: string;
  gender: string | null;
  matric_no: string | null;
  department_id: string;
}

interface Course {
  id: string;
  name: string;
  code: string;
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
  status: 'P' | 'A';
  synced: boolean;
  error?: string;
}

const DeptAdminDashboard = () => {
  const { profile, user } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [departmentName, setDepartmentName] = useState<string>('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [dateColumns, setDateColumns] = useState<string[]>([new Date().toISOString().split('T')[0]]);
  const [grid, setGrid] = useState<Record<string, Record<string, 'P' | 'A' | ''>>>({});
  const [localAttendance, setLocalAttendance] = useState<LocalAttendance[]>([]);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'mark' | 'history' | 'students'>('mark');
  const [studentEdits, setStudentEdits] = useState<Record<string, Partial<Student>>>({});
  const [savingStudents, setSavingStudents] = useState(false);
  const [syncingAttendance, setSyncingAttendance] = useState(false);
  const [sheetsBusy, setSheetsBusy] = useState<false | 'sync' | 'export'>(false);
  const [connectionStatus, setConnectionStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [qrSession, setQrSession] = useState<{ token: string; expires_at: string; course_id: string; date: string } | null>(null);
  const [qrCourseId, setQrCourseId] = useState<string>('');
  const [qrDate, setQrDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [qrDurationMin, setQrDurationMin] = useState<number>(15);
  const [qrCreating, setQrCreating] = useState(false);
  const [qrLat, setQrLat] = useState<number | null>(null);
  const [qrLng, setQrLng] = useState<number | null>(null);
  const [qrRadius, setQrRadius] = useState<number>(100);
  const [qrEnding, setQrEnding] = useState(false);
  const [provisioningAuth, setProvisioningAuth] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!qrSession) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [qrSession]);


  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newStudent, setNewStudent] = useState({ name: '', gender: '', matric_no: '' });
  const [addingStudent, setAddingStudent] = useState(false);

  const [showCourseDialog, setShowCourseDialog] = useState(false);
  const [newCourse, setNewCourse] = useState({ name: '', code: '' });
  const [addingCourse, setAddingCourse] = useState(false);

  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareFileName, setShareFileName] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const pdfBlobRef = useRef<Blob | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPercent, setFilterPercent] = useState<string>('all');
  const [deletingHistory, setDeletingHistory] = useState(false);

  // Check connection status
  useEffect(() => {
    const checkConnection = async () => {
      setConnectionStatus('checking');
      try {
        const { error } = await supabase.from('attendance').select('count', { count: 'exact', head: true });
        setConnectionStatus(error ? 'offline' : 'online');
      } catch {
        setConnectionStatus('offline');
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

  const initializeDashboard = async () => {
    try {
      setInitialLoading(true);
      await Promise.all([
        fetchStudents(),
        fetchHistory(),
        fetchDepartmentName(),
        fetchCourses(),
        loadLocalAttendance()
      ]);
    } catch (error) {
      console.error('Error initializing dashboard:', error);
      toast.error('Failed to load dashboard data. Please refresh the page.');
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
        
        const localGrid: Record<string, Record<string, 'P' | 'A' | ''>> = {};
        parsed.forEach((item: LocalAttendance) => {
          if (!localGrid[item.studentId]) localGrid[item.studentId] = {};
          localGrid[item.studentId][item.date] = item.status;
        });
        
        setGrid(prev => {
          const merged = { ...prev };
          Object.keys(localGrid).forEach(studentId => {
            merged[studentId] = { ...merged[studentId], ...localGrid[studentId] };
          });
          return merged;
        });
        
        const pendingCount = parsed.filter((item: LocalAttendance) => !item.synced).length;
        if (pendingCount > 0) {
          toast.info(`${pendingCount} unsynced attendance records found`);
        }
      } catch (e) {
        console.error('Failed to load local attendance:', e);
        toast.error('Failed to load saved attendance data');
      }
    }
  };

  const saveLocalAttendance = () => {
    try {
      localStorage.setItem(`attendance_${profile?.department_id}`, JSON.stringify(localAttendance));
    } catch (e) {
      console.error('Failed to save local attendance:', e);
    }
  };

  const clearLocalAttendance = () => {
    localStorage.removeItem(`attendance_${profile?.department_id}`);
    setLocalAttendance([]);
    toast.success('Local attendance data cleared');
  };

  const fetchDepartmentName = async () => {
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('name')
        .eq('id', profile!.department_id!)
        .single();
      
      if (error) throw error;
      if (data) setDepartmentName(data.name);
    } catch (error) {
      console.error('Error fetching department:', error);
      setDepartmentName('Unknown Department');
    }
  };

  const fetchCourses = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('courses')
        .select('*')
        .eq('department_id', profile!.department_id!)
        .order('name');
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        setCourses(data as Course[]);
        if (!selectedCourse) {
          setSelectedCourse(data[0].id);
        }
      } else {
        const { data: newCourse, error: createError } = await (supabase as any)
          .from('courses')
          .insert({
            name: 'General Attendance',
            code: 'GEN001',
            department_id: profile!.department_id
          })
          .select()
          .single();
        
        if (createError) throw createError;
        if (newCourse) {
          setCourses([newCourse]);
          setSelectedCourse(newCourse.id);
          toast.success('Created default course');
        }
      }
    } catch (error: any) {
      console.error('Error fetching courses:', error);
      toast.error(`Failed to load courses: ${error.message}`);
    }
  };

  const fetchStudents = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('students')
        .select('id, name, gender, matric_no, department_id')
        .eq('department_id', profile!.department_id!)
        .order('name');
      
      if (error) throw error;
      if (data) setStudents(data as Student[]);
    } catch (error: any) {
      console.error('Error fetching students:', error);
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
          .from('attendance')
          .select(`
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
            `)
          .eq('department_id', profile!.department_id!)
          .order('date', { ascending: false })
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
      console.error('Error fetching history:', error);
      toast.error(`Failed to load history: ${error.message}`);
    }
  };

  const fetchAttendanceGrid = async () => {
    if (!profile?.department_id) return;

    try {
      const { data, error } = await supabase
        .from('attendance')
        .select('student_ref, date, status')
        .eq('department_id', profile.department_id);

      if (error) throw error;

      if (!data) return;

      const newGrid: any = {};
      data.forEach((r: any) => {
        const val = r.status === 'present' ? 'P' : 'A';
        if (!newGrid[r.student_ref]) newGrid[r.student_ref] = {};
        newGrid[r.student_ref][r.date] = val;
      });

      const unsynced = localAttendance.filter(item => !item.synced);
      unsynced.forEach(item => {
        if (!newGrid[item.studentId]) newGrid[item.studentId] = {};
        newGrid[item.studentId][item.date] = item.status;
      });

      setGrid(newGrid);
    } catch (error: any) {
      console.error('Error fetching attendance grid:', error);
    }
  };

  const addCourse = async () => {
    if (!newCourse.name.trim() || !newCourse.code.trim()) {
      toast.error('Course name and code are required');
      return;
    }
    if (!profile?.department_id) return;
    setAddingCourse(true);

    try {
      const { error } = await (supabase as any).from('courses').insert({
        name: newCourse.name.trim(),
        code: newCourse.code.trim().toUpperCase(),
        department_id: profile.department_id,
      });

      if (error) throw error;

      toast.success('Course added successfully');
      setNewCourse({ name: '', code: '' });
      setShowCourseDialog(false);
      await fetchCourses();
    } catch (error: any) {
      console.error('Error adding course:', error);
      toast.error(`Failed to add course: ${error.message}`);
    } finally {
      setAddingCourse(false);
    }
  };

  const addDateColumn = () => {
    const newDate = new Date().toISOString().split('T')[0];
    if (!dateColumns.includes(newDate)) {
      setDateColumns(prev => [...prev, newDate]);
    } else {
      let d = new Date();
      while (dateColumns.includes(d.toISOString().split('T')[0])) {
        d.setDate(d.getDate() + 1);
      }
      setDateColumns(prev => [...prev, d.toISOString().split('T')[0]]);
    }
  };

  const updateDateColumn = (index: number, value: string) => {
    setDateColumns(prev => prev.map((d, i) => i === index ? value : d));
  };

  const removeDateColumn = (index: number) => {
    if (dateColumns.length <= 1) return;
    const dateToRemove = dateColumns[index];
    setDateColumns(prev => prev.filter((_, i) => i !== index));
    setGrid(prev => {
      const next = { ...prev };
      for (const sid of Object.keys(next)) {
        const { [dateToRemove]: _, ...rest } = next[sid];
        next[sid] = rest;
      }
      return next;
    });
    setLocalAttendance(prev => prev.filter(item => item.date !== dateToRemove));
  };

  const toggleCell = (studentId: string, date: string) => {
    setGrid(prev => {
      const current = prev[studentId]?.[date] || '';
      const nextStatus = current === '' ? 'P' : current === 'P' ? 'A' : '';
      
      setLocalAttendance(prevLocal => {
        const existing = prevLocal.find(item => 
          item.studentId === studentId && item.date === date
        );
        if (existing) {
          if (nextStatus === '') {
            return prevLocal.filter(item => 
              !(item.studentId === studentId && item.date === date)
            );
          } else {
            return prevLocal.map(item => 
              item.studentId === studentId && item.date === date
                ? { ...item, status: nextStatus, synced: false, error: undefined, courseId: selectedCourse }
                : item
            );
          }
        } else if (nextStatus !== '') {
          return [...prevLocal, { studentId, courseId: selectedCourse, date, status: nextStatus, synced: false }];
        }
        return prevLocal;
      });
      
      return {
        ...prev,
        [studentId]: { ...prev[studentId], [date]: nextStatus },
      };
    });
  };

  const markAllForDate = (date: string, status: 'P' | 'A') => {
    setGrid(prev => {
      const next = { ...prev };
      for (const student of students) {
        if (next[student.id]) {
          next[student.id][date] = status;
        } else {
          next[student.id] = { [date]: status };
        }
        
        setLocalAttendance(prevLocal => {
          const existing = prevLocal.find(item => 
            item.studentId === student.id && item.date === date
          );
          if (existing) {
            return prevLocal.map(item => 
              item.studentId === student.id && item.date === date
                ? { ...item, status, synced: false, error: undefined, courseId: selectedCourse }
                : item
            );
          } else {
            return [...prevLocal, { studentId: student.id, courseId: selectedCourse, date, status, synced: false }];
          }
        });
      }
      return next;
    });
    
    toast.info(`Marked all students as ${status === 'P' ? 'Present' : 'Absent'} for ${date}`);
  };

  const syncAttendanceToDatabase = async () => {
    if (connectionStatus === 'offline') {
      toast.error('You are offline. Please check your internet connection and try again.');
      return;
    }
    
    if (!profile?.department_id || !user?.id) {
      toast.error('Missing department or user information');
      return;
    }
    
    const unsynced = localAttendance.filter(item => !item.synced);
    if (unsynced.length === 0) {
      toast.info('No unsynced attendance records to save');
      return;
    }
    
    setSyncingAttendance(true);
    
    let successCount = 0;
    let errorCount = 0;
    
    try {
      // Build rows for a single batched upsert (fast: 1 round-trip instead of 2N)
      const rows = unsynced.map(item => ({
        student_ref: item.studentId,
        course_id: item.courseId,
        department_id: profile.department_id,
        marked_by: user.id,
        date: item.date,
        status: item.status === 'P' ? 'present' : 'absent',
      }));

      // Chunk to avoid payload limits on very large saves
      const chunkSize = 500;
      const chunks: typeof rows[] = [];
      for (let i = 0; i < rows.length; i += chunkSize) {
        chunks.push(rows.slice(i, i + chunkSize));
      }

      const results = await Promise.all(
        chunks.map(chunk =>
          (supabase as any)
            .from('attendance')
            .upsert(chunk, { onConflict: 'student_ref,course_id,date' })
        )
      );

      results.forEach((res, idx) => {
        if (res.error) {
          console.error('Upsert error:', res.error);
          errorCount += chunks[idx].length;
        } else {
          successCount += chunks[idx].length;
        }
      });

      if (successCount > 0) {
        setLocalAttendance(prev =>
          prev.map(item => {
            const wasSynced = unsynced.some(u =>
              u.studentId === item.studentId && u.date === item.date && u.courseId === item.courseId
            );
            return wasSynced ? { ...item, synced: true, error: undefined } : item;
          })
        );

        toast.success(`Saved ${successCount} attendance record${successCount !== 1 ? 's' : ''}`);
        // Refresh in parallel + don't block the UI
        void Promise.all([fetchAttendanceGrid(), fetchHistory()]);
      }

      if (errorCount > 0) {
        toast.error(`Failed to sync ${errorCount} record${errorCount !== 1 ? 's' : ''}. Please try again.`);
      }
    } catch (error: any) {
      console.error('Sync error:', error);
      toast.error(`Sync failed: ${error.message || 'Unknown error'}`);
      
      setLocalAttendance(prev => 
        prev.map(item => {
          const wasUnsynced = unsynced.some(u => 
            u.studentId === item.studentId && u.date === item.date
          );
          return wasUnsynced ? { ...item, error: error.message } : item;
        })
      );
    } finally {
      setSyncingAttendance(false);
    }
  };

  

  const pushToGoogleSheets = async (action: 'sync_unsynced' | 'export_all') => {
    setSheetsBusy(action === 'export_all' ? 'export' : 'sync');
    try {
      const { data, error } = await supabase.functions.invoke('sheets-sync', { body: { action } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Unknown error');
      if (data.synced > 0) {
        toast.success(`Synced ${data.synced} record${data.synced !== 1 ? 's' : ''} to Google Sheets`, {
          description: data.spreadsheetUrl ? 'Open spreadsheet' : undefined,
          action: data.spreadsheetUrl ? { label: 'Open', onClick: () => window.open(data.spreadsheetUrl, '_blank') } : undefined,
        });
      } else {
        toast.info(data.message || 'Nothing new to sync');
      }
      await fetchHistory();
    } catch (err: any) {
      console.error('Google Sheets sync failed:', err);
      toast.error(`Google Sheets sync failed: ${err.message || 'Unknown error'}`);
    } finally {
      setSheetsBusy(false);
    }
  };

  const saveAttendance = async () => {
    await syncAttendanceToDatabase();
    // Fire-and-forget Google Sheets push so the UI unblocks immediately.
    // Sheets sync can take several seconds; we don't make the user wait.
    void pushToGoogleSheets('sync_unsynced').catch((err) => {
      console.warn('Sheets background sync failed (non-blocking):', err);
    });
  };


  const exportCSV = () => {
    if (students.length === 0) {
      toast.error('No students to export');
      return;
    }

    const currentCourse = courses.find(c => c.id === selectedCourse);
    const headers = ['S/N', 'Name', 'Gender', 'Matric No', 'Department', 'Course', ...dateColumns];
    const rows = students.map((s, i) => {
      const cells = [
        String(i + 1),
        s.name,
        s.gender || '',
        s.matric_no || '',
        departmentName,
        currentCourse?.name || 'All Courses',
        ...dateColumns.map(d => grid[s.id]?.[d] || ''),
      ];
      return cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');
    });

    const csv = "\uFEFF" + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_${departmentName}_${currentCourse?.code || 'all'}_${dateColumns[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported successfully');
  };

  const exportExcel = () => {
    if (students.length === 0) {
      toast.error('No students to export');
      return;
    }

    const currentCourse = courses.find(c => c.id === selectedCourse);
    const data = students.map((s, i) => {
      const row: any = {
        "S/N": i + 1,
        "Name": s.name,
        "Gender": s.gender || '',
        "Matric No": s.matric_no || '',
        "Department": departmentName,
        "Course": currentCourse?.name || 'All Courses',
      };

      dateColumns.forEach(d => {
        const value = grid[s.id]?.[d] || '';
        row[d] = value === 'P' ? 'Present' : value === 'A' ? 'Absent' : '';
      });

      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const cols = Object.keys(data[0]).map(key => ({
      wch: Math.max(key.length, ...data.map(row => String(row[key] || '').length)) + 2
    }));
    worksheet['!cols'] = cols;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance");
    XLSX.writeFile(workbook, `attendance_${departmentName}_${currentCourse?.code || 'all'}.xlsx`);
    toast.success('Excel exported successfully');
  };

  const generatePDF = (): jsPDF => {
    const doc = new jsPDF();
    const currentCourse = courses.find(c => c.id === selectedCourse);
    
    doc.setFontSize(16);
    doc.text('ATTENDANCE REPORT', 105, 15, { align: 'center' });
    
    doc.setFontSize(12);
    doc.text(`Department: ${departmentName}`, 14, 25);
    doc.text(`Course: ${currentCourse ? `${currentCourse.code} - ${currentCourse.name}` : 'All Courses'}`, 14, 32);
    doc.text(`Date Generated: ${new Date().toLocaleDateString()}`, 14, 39);
    
    const filteredHistory = selectedCourse 
      ? history.filter(r => r.course_id === selectedCourse)
      : history;
    
    const tableData = filteredHistory.map((a, i) => [
      i + 1,
      a.students?.name ?? 'Unknown',
      a.students?.matric_no ?? '-',
      a.students?.gender ?? '-',
      a.courses?.name ?? '-',
      a.date,
      a.status,
    ]);
    
    autoTable(doc, {
      startY: 48,
      head: [['S/N', 'Student Name', 'Matric No', 'Gender', 'Course', 'Date', 'Status']],
      body: tableData,
      styles: { fontSize: 10, cellPadding: 3 },
      headStyles: { fillColor: [22, 160, 133], textColor: 255 },
      alternateRowStyles: { fillColor: [240, 240, 240] },
      didParseCell: function (data) {
        if (data.column.index === 6) {
          if (data.cell.raw === 'present') data.cell.styles.textColor = [0, 150, 0];
          if (data.cell.raw === 'absent') data.cell.styles.textColor = [200, 0, 0];
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
      doc.setGState(new (doc as any).GState({ opacity: 0.40 }));
      doc.text('Attendtrack', pageWidth / 2, pageHeight / 2, { align: 'center', angle: 45 });
      doc.restoreGraphicsState();
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.text(`Page ${i} of ${pageCount}`, 105, 290, { align: 'center' });
    }

    return doc;
  };

  const sharePDF = async () => {
    const filteredHistory = selectedCourse
      ? history.filter(r => r.course_id === selectedCourse)
      : history;

    if (filteredHistory.length === 0) {
      toast.error('No attendance history to share');
      return;
    }

    try {
      const doc = generatePDF();
      const pdfBlob = doc.output('blob');
      const currentCourse = courses.find(c => c.id === selectedCourse);
      const fileName = `attendance_${departmentName}_${currentCourse?.code || 'all'}.pdf`;
      const message = `Attendance report for ${departmentName}${currentCourse ? ` - ${currentCourse.name}` : ''}`;

      pdfBlobRef.current = pdfBlob;
      setShareFileName(fileName);
      setShareMessage(message);
      setShowShareDialog(true);
    } catch (error: any) {
      console.error('Share error:', error);
      toast.error('Failed to prepare PDF');
    }
  };

  const downloadPDF = () => {
    if (!pdfBlobRef.current) return;
    const url = URL.createObjectURL(pdfBlobRef.current);
    const a = document.createElement('a');
    a.href = url;
    a.download = shareFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('PDF downloaded');
  };

  const shareViaNative = async () => {
    if (!pdfBlobRef.current) return;
    try {
      const file = new File([pdfBlobRef.current], shareFileName, { type: 'application/pdf' });
      const shareData: any = { title: 'Attendance Report', text: shareMessage, files: [file] };
      if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        toast.success('Shared successfully');
        setShowShareDialog(false);
      } else {
        toast.error('Native sharing not supported here. Please download and share manually.');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.warn('Native share failed:', err);
      toast.error('Native share blocked. Please download the PDF and share manually.');
    }
  };

  const shareViaWhatsApp = () => {
    downloadPDF();
    window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage + ' (PDF downloaded — please attach it)')}`, '_blank');
  };

  const shareViaTelegram = () => {
    downloadPDF();
    window.open(`https://t.me/share/url?url=${encodeURIComponent(shareMessage)}&text=${encodeURIComponent(shareMessage)}`, '_blank');
  };

  const shareViaEmail = () => {
    downloadPDF();
    window.location.href = `mailto:?subject=${encodeURIComponent('Attendance Report')}&body=${encodeURIComponent(shareMessage + '\n\nPlease find the attached PDF (downloaded to your device).')}`;
  };

  const updateStudentField = (id: string, field: string, value: string) => {
    setStudentEdits(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const saveStudentDetails = async () => {
    setSavingStudents(true);
    const editEntries = Object.entries(studentEdits);
    if (editEntries.length === 0) {
      toast.info('No changes to save');
      setSavingStudents(false);
      return;
    }

    let hasError = false;
    for (const [id, edits] of editEntries) {
      const { error } = await (supabase as any).from('students').update(edits).eq('id', id);
      if (error) {
        toast.error(`Failed to update student: ${error.message}`);
        hasError = true;
        break;
      }
    }

    if (!hasError) {
      toast.success('Student details saved successfully');
      setStudentEdits({});
      fetchStudents();
    }
    setSavingStudents(false);
  };

  const addStudent = async () => {
    if (!newStudent.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!profile?.department_id) return;
    setAddingStudent(true);

    try {
      const { error } = await (supabase as any).from('students').insert({
        name: newStudent.name.trim(),
        gender: newStudent.gender || null,
        matric_no: newStudent.matric_no.trim() || null,
        department_id: profile.department_id,
      });

      if (error) throw error;

      toast.success('Student added successfully');
      setNewStudent({ name: '', gender: '', matric_no: '' });
      setShowAddDialog(false);
      await fetchStudents();
    } catch (error: any) {
      toast.error(`Failed to add student: ${error.message}`);
    } finally {
      setAddingStudent(false);
    }
  };

  const deleteStudent = async (id: string, name: string) => {
    if (!confirm(`Delete student "${name}"? This will also delete their attendance records. This cannot be undone.`)) return;
    
    try {
      const { error } = await (supabase as any).from('students').delete().eq('id', id);
      if (error) throw error;
      
      toast.success('Student deleted successfully');
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
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        toast.error('CSV must have a header row and at least one data row');
        setImporting(false);
        return;
      }

      const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
      const nameIdx = headers.findIndex(h => h === 'name');
      const genderIdx = headers.findIndex(h => h === 'gender');
      const matricIdx = headers.findIndex(h => h.includes('matric'));

      if (nameIdx === -1) {
        toast.error('CSV must have a "name" column');
        setImporting(false);
        return;
      }

      const csvRows = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim());
        return {
          name: cols[nameIdx] || '',
          gender: genderIdx >= 0 ? cols[genderIdx] || null : null,
          matric_no: matricIdx >= 0 ? cols[matricIdx] || null : null,
          department_id: profile.department_id!,
        };
      }).filter(s => s.name);

      if (csvRows.length === 0) {
        toast.error('No valid students found in CSV');
        setImporting(false);
        return;
      }

      const { error } = await (supabase as any).from('students').insert(csvRows);
      if (error) throw error;
      
      toast.success(`Successfully imported ${csvRows.length} students`);
      await fetchStudents();
    } catch (error: any) {
      toast.error(`Import failed: ${error.message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const deleteAllHistory = async () => {
    if (!confirm('⚠️ WARNING: This will delete ALL attendance history for your department. This action cannot be undone. Are you absolutely sure?')) return;
    if (!profile?.department_id) return;
    
    setDeletingHistory(true);
    try {
      const { error } = await (supabase as any)
        .from('attendance')
        .delete()
        .eq('department_id', profile.department_id);
      
      if (error) throw error;
      
      toast.success('All attendance history deleted');
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
    const filteredHistoryForStats = selectedCourse 
      ? history.filter(r => r.course_id === selectedCourse)
      : history;
      
    return students.map(student => {
      const records = filteredHistoryForStats.filter(
        r => r.student_ref === student.id && r.date.startsWith(month)
      );
      const total = records.length;
      const present = records.filter(r => r.status === 'present').length;
      const percent = total ? (present / total) * 100 : 0;
      return { ...student, present, total, percent };
    });
  }, [students, history, selectedCourse]);

  const filteredStats = useMemo(() => {
    let result = studentStats;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.matric_no && s.matric_no.toLowerCase().includes(q))
      );
    }
    if (filterPercent === 'below75') {
      result = result.filter(s => s.percent < 75);
    } else if (filterPercent === 'above75') {
      result = result.filter(s => s.percent >= 75);
    }
    return result;
  }, [studentStats, searchQuery, filterPercent]);

  const filteredHistory = useMemo(() => {
    if (!selectedCourse) return history;
    return history.filter(r => r.course_id === selectedCourse);
  }, [history, selectedCourse]);

  const pendingSyncCount = localAttendance.filter(item => !item.synced).length;
  const failedSyncCount = localAttendance.filter(item => item.error && !item.synced).length;

  if (!profile?.department_id) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="max-w-md">
            <CardContent className="pt-6 text-center">
              <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
              <p className="text-muted-foreground">You haven't been assigned to a department yet.</p>
              <p className="text-sm text-muted-foreground mt-2">Please contact a super administrator to assign you to a department.</p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const statusStyles: Record<string, string> = {
    present: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    absent: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };

  const cellStyles: Record<string, string> = {
    P: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    A: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    '': 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  };

  const tabs = [
    { id: 'mark' as const, label: 'Mark Attendance', icon: CalendarCheck },
    { id: 'students' as const, label: 'Students', icon: Users },
    { id: 'history' as const, label: 'History', icon: History },
  ];

  // Live QR session helpers
  const createQrSession = async () => {
    if (!qrCourseId) { toast.error('Pick a course first'); return; }
    if (!profile?.department_id || !user) { toast.error('Missing profile'); return; }
    setQrCreating(true);
    try {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(18)))
        .map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
      const expires_at = new Date(Date.now() + qrDurationMin * 60_000).toISOString();
      const { data, error } = await (supabase as any).from('attendance_sessions').insert({
        course_id: qrCourseId,
        department_id: profile.department_id,
        date: qrDate,
        token,
        expires_at,
        created_by: user.id,
      }).select('token, expires_at, course_id, date').single();
      if (error) throw error;
      setQrSession(data);
      toast.success('Live session started');
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to start session');
    } finally {
      setQrCreating(false);
    }
  };

  const endQrSession = async () => {
    if (!qrSession) return;
    await (supabase as any).from('attendance_sessions').update({ expires_at: new Date().toISOString() }).eq('token', qrSession.token);
    setQrSession(null);
    toast.message('Session ended');
  };

  const provisionStudentLogins = async () => {
    setProvisioningAuth(true);
    try {
      const { data, error } = await supabase.functions.invoke('provision-student-auth', { body: {} });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
      const created = (data as any)?.results?.filter((r: any) => r.status === 'created').length ?? 0;
      const existing = (data as any)?.results?.filter((r: any) => r.status === 'already_provisioned').length ?? 0;
      const failed = (data as any)?.results?.filter((r: any) => r.error || r.skipped).length ?? 0;
      toast.success(`Provisioned ${created} new, ${existing} already had logins${failed ? `, ${failed} skipped/failed` : ''}.`);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to provision logins');
    } finally {
      setProvisioningAuth(false);
    }
  };


  if (initialLoading) {
    return <LoadingScreen message="Loading dashboard..." />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold">Department Admin Dashboard</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Department: <span className="font-semibold text-foreground">{departmentName}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {connectionStatus === 'online' ? (
              <Badge className="bg-green-100 text-green-800">
                <Check className="w-3 h-3 mr-1" /> Online
              </Badge>
            ) : connectionStatus === 'offline' ? (
              <Badge className="bg-red-100 text-red-800">
                <WifiOff className="w-3 h-3 mr-1" /> Offline
              </Badge>
            ) : (
              <Badge variant="outline">
                <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Checking
              </Badge>
            )}
          </div>
        </div>

        <ProgressSummary department={departmentName} />


        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <BookOpen className="w-5 h-5" /> Courses / Subjects
                </CardTitle>
                <p className="text-sm text-muted-foreground">Add courses like PHY 101, CHM 101 to mark attendance separately</p>
              </div>
              <Dialog open={showCourseDialog} onOpenChange={setShowCourseDialog}>
                <DialogTrigger asChild>
                  <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Course</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add New Course</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div>
                      <label className="text-sm font-medium">Course Code *</label>
                      <Input 
                        value={newCourse.code} 
                        onChange={e => setNewCourse(p => ({ ...p, code: e.target.value }))} 
                        placeholder="e.g., PHY 101, CHM 101" 
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Course Name *</label>
                      <Input 
                        value={newCourse.name} 
                        onChange={e => setNewCourse(p => ({ ...p, name: e.target.value }))} 
                        placeholder="e.g., General Physics, Organic Chemistry" 
                      />
                    </div>
                    <Button onClick={addCourse} disabled={addingCourse} className="w-full">
                      {addingCourse ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                      {addingCourse ? 'Adding...' : 'Add Course'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={!selectedCourse ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCourse('')}
                className="mb-2"
              >
                All Courses
              </Button>
              {courses.map(course => (
                <Button
                  key={course.id}
                  variant={selectedCourse === course.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCourse(course.id)}
                  className="mb-2"
                >
                  {course.code}
                </Button>
              ))}
              {courses.length === 0 && (
                <p className="text-muted-foreground text-sm">No courses added yet. Click "Add Course" to create one.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
          <div className="flex gap-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <tab.icon className="w-4 h-4" /> {tab.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="default" onClick={() => { setQrCourseId(selectedCourse || ''); setShowQrDialog(true); }}>
              <QrCode className="w-4 h-4 mr-1" /> Live QR Session
            </Button>
            <Button size="sm" variant="outline" onClick={provisionStudentLogins} disabled={provisioningAuth}>
              {provisioningAuth ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <KeyRound className="w-4 h-4 mr-1" />}
              Create Student Logins
            </Button>
            <SheetsActions
              busy={sheetsBusy}
              size="sm"
              onExport={() => pushToGoogleSheets('export_all')}
              onSync={() => pushToGoogleSheets('sync_unsynced')}
            />
            <SheetsSettingsDialog />
          </div>
        </div>

        <Dialog open={showQrDialog} onOpenChange={(o) => { setShowQrDialog(o); if (!o) { setQrSession(null); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Live QR Attendance Session</DialogTitle></DialogHeader>
            {!qrSession ? (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-sm font-medium">Course</label>
                  <Select value={qrCourseId} onValueChange={setQrCourseId}>
                    <SelectTrigger><SelectValue placeholder="Pick a course" /></SelectTrigger>
                    <SelectContent>
                      {courses.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.code} - {c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Date</label>
                  <Input type="date" value={qrDate} onChange={e => setQrDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium">Duration</label>
                  <Select value={String(qrDurationMin)} onValueChange={v => setQrDurationMin(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 minutes</SelectItem>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={createQrSession} disabled={qrCreating || !qrCourseId} className="w-full">
                  {qrCreating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <QrCode className="w-4 h-4 mr-2" />}
                  Start session
                </Button>
                <p className="text-xs text-muted-foreground">
                  Students scan the QR with the AttendTrack app (Scan QR button) to mark themselves present.
                </p>
              </div>
            ) : (() => {
              const scanUrl = `${window.location.origin}/scan?token=${qrSession.token}`;
              const remainingMs = new Date(qrSession.expires_at).getTime() - now;
              const remaining = Math.max(0, Math.floor(remainingMs / 1000));
              const mm = Math.floor(remaining / 60).toString().padStart(2, '0');
              const ss = (remaining % 60).toString().padStart(2, '0');
              const expired = remainingMs <= 0;
              return (
                <div className="space-y-3 pt-2 text-center">
                  <div className="bg-white p-4 rounded-lg inline-block mx-auto">
                    <QRCodeCanvas value={scanUrl} size={240} includeMargin />
                  </div>
                  <p className="text-2xl font-mono font-bold">{expired ? 'EXPIRED' : `${mm}:${ss}`}</p>
                  <p className="text-xs text-muted-foreground break-all">{scanUrl}</p>
                  <div className="flex gap-2 justify-center">
                    <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(scanUrl); toast.success('Link copied'); }}>
                      <Copy className="w-4 h-4 mr-1" /> Copy link
                    </Button>
                    <Button size="sm" variant="destructive" onClick={endQrSession}>End session</Button>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>




        {activeTab === 'mark' && (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Mark Attendance</CardTitle>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Department: {departmentName}
                    {selectedCourse && courses.find(c => c.id === selectedCourse) && (
                      <span className="ml-2 font-semibold">
                        | Course: {courses.find(c => c.id === selectedCourse)?.code} - {courses.find(c => c.id === selectedCourse)?.name}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={addDateColumn}>
                    <Plus className="w-4 h-4 mr-1" /> Add Date
                  </Button>
                  <Button variant="outline" onClick={exportCSV} disabled={students.length === 0}>
                    <Download className="w-4 h-4 mr-1" /> Export CSV
                  </Button>
                  <Button variant="outline" onClick={exportExcel} disabled={students.length === 0}>
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
                  <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Share Attendance PDF</DialogTitle></DialogHeader>
                      <div className="space-y-2 pt-2">
                        <p className="text-sm text-muted-foreground">{shareFileName}</p>
                        <Button className="w-full" onClick={downloadPDF}>
                          <Download className="w-4 h-4 mr-2" /> Download PDF
                        </Button>
                        <Button variant="outline" className="w-full" onClick={shareViaNative}>
                          Share via device (if supported)
                        </Button>
                        <Button variant="outline" className="w-full" onClick={shareViaWhatsApp}>
                          WhatsApp (downloads PDF + opens chat)
                        </Button>
                        <Button variant="outline" className="w-full" onClick={shareViaTelegram}>
                          Telegram (downloads PDF + opens chat)
                        </Button>
                        <Button variant="outline" className="w-full" onClick={shareViaEmail}>
                          Email (downloads PDF + opens mail)
                        </Button>
                        <p className="text-xs text-muted-foreground pt-2">
                          Tip: native sharing is blocked inside the preview iframe. Open the published app on your phone for one-tap sharing, or download here and attach manually.
                        </p>
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Button 
                    onClick={saveAttendance} 
                    disabled={syncingAttendance || pendingSyncCount === 0 || connectionStatus === 'offline'}
                    variant={pendingSyncCount > 0 ? 'default' : 'outline'}
                  >
                    {syncingAttendance ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-1" />
                    )}
                    {syncingAttendance ? 'Syncing...' : `Save All (${pendingSyncCount})`}
                  </Button>
                  {failedSyncCount > 0 && (
                    <Button onClick={syncAttendanceToDatabase} variant="destructive" size="sm">
                      <RefreshCw className="w-4 h-4 mr-1" /> Retry Failed ({failedSyncCount})
                    </Button>
                  )}
                </div>
              </div>
              
              {pendingSyncCount > 0 && (
                <Badge className="mt-2 bg-yellow-100 text-yellow-800">
                  <Database className="w-3 h-3 mr-1" />
                  {pendingSyncCount} unsynced record{pendingSyncCount !== 1 ? 's' : ''}
                </Badge>
              )}
              
              {failedSyncCount > 0 && (
                <Badge className="mt-2 bg-red-100 text-red-800 ml-2">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {failedSyncCount} failed record{failedSyncCount !== 1 ? 's' : ''}
                </Badge>
              )}
              
              {connectionStatus === 'offline' && (
                <Badge className="mt-2 bg-red-100 text-red-800">
                  <WifiOff className="w-3 h-3 mr-1" />
                  You are offline. Changes will be saved locally and synced when you reconnect.
                </Badge>
              )}
              
              <p className="text-xs text-muted-foreground mt-2">Click a cell to toggle: empty → <Check className="inline w-3 h-3 text-green-600" /> (Present) → <X className="inline w-3 h-3 text-red-600" /> (Absent) → empty</p>
              <p className="text-xs text-muted-foreground">Changes are saved locally and will be synced when you click "Save All"</p>
            </CardHeader>
            <CardContent>
              {students.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No students yet.</p>
                  <Button variant="link" onClick={() => setActiveTab('students')} className="mt-2">
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
                        <TableHead className="w-16 text-center">Gender</TableHead>
                        <TableHead className="min-w-[130px]">Matric No</TableHead>
                        <TableHead className="min-w-[120px]">Department</TableHead>
                        {dateColumns.map((date, i) => (
                          <TableHead key={i} className="text-center min-w-[110px]">
                            <div className="flex flex-col items-center gap-1">
                              <Input
                                type="date"
                                value={date}
                                onChange={e => updateDateColumn(i, e.target.value)}
                                className="h-7 text-xs w-[120px] px-1"
                              />
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => markAllForDate(date, 'P')}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-300 dark:hover:bg-green-800 flex items-center gap-0.5"
                                  title="Mark all present"
                                >
                                  <CheckCheck className="w-3 h-3" /> All P
                                </button>
                                <button
                                  onClick={() => markAllForDate(date, 'A')}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800 flex items-center gap-0.5"
                                  title="Mark all absent"
                                >
                                  <XCircle className="w-3 h-3" /> All A
                                </button>
                              </div>
                              {dateColumns.length > 1 && (
                                <button onClick={() => removeDateColumn(i)} className="text-[10px] text-destructive hover:underline">
                                  remove
                                </button>
                              )}
                            </div>
                          </TableHead>
                        ))}
                        <TableHead className="w-20 text-center">Remark</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {students.map((student, idx) => (
                        <TableRow key={student.id}>
                          <TableCell className="text-center font-medium">{idx + 1}</TableCell>
                          <TableCell className="font-medium">{student.name}</TableCell>
                          <TableCell className="text-center text-sm">{student.gender ? student.gender.charAt(0) : ''}</TableCell>
                          <TableCell className="text-sm">{student.matric_no || ''}</TableCell>
                          <TableCell className="text-sm">{departmentName}</TableCell>
                          {dateColumns.map((date, i) => {
                            const val = grid[student.id]?.[date] || '';
                            const isPending = localAttendance.some(
                              item => item.studentId === student.id && item.date === date && !item.synced
                            );
                            const hasError = localAttendance.some(
                              item => item.studentId === student.id && item.date === date && item.error
                            );
                            return (
                              <TableCell key={i} className="text-center p-1">
                                <button
                                  onClick={() => toggleCell(student.id, date)}
                                  className={`w-full h-8 rounded text-xs font-bold transition-colors flex items-center justify-center relative ${cellStyles[val]}`}
                                  disabled={connectionStatus === 'offline' && !isPending}
                                >
                                  {val === 'P' ? <Check className="w-4 h-4" /> : val === 'A' ? <X className="w-4 h-4" /> : '—'}
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
                          <TableCell className="text-center text-sm text-muted-foreground">—</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'students' && (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-lg">Student Details</CardTitle>
                <div className="flex items-center gap-2">
                  <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCSVImport} className="hidden" />
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                    {importing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
                    {importing ? 'Importing...' : 'Import CSV'}
                  </Button>
                  <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                    <DialogTrigger asChild>
                      <Button><Plus className="w-4 h-4 mr-1" /> Add Student</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Add New Student</DialogTitle></DialogHeader>
                      <div className="space-y-4 pt-2">
                        <div>
                          <label className="text-sm font-medium">Name *</label>
                          <Input value={newStudent.name} onChange={e => setNewStudent(p => ({ ...p, name: e.target.value }))} placeholder="Full name" />
                        </div>
                        <div>
                          <label className="text-sm font-medium">Gender</label>
                          <Select value={newStudent.gender} onValueChange={v => setNewStudent(p => ({ ...p, gender: v }))}>
                            <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Male">Male</SelectItem>
                              <SelectItem value="Female">Female</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-medium">Matric No</label>
                          <Input value={newStudent.matric_no} onChange={e => setNewStudent(p => ({ ...p, matric_no: e.target.value }))} placeholder="e.g., MAT/2024/001" />
                        </div>
                        <Button onClick={addStudent} disabled={addingStudent} className="w-full">
                          {addingStudent ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                          {addingStudent ? 'Adding...' : 'Add Student'}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  {Object.keys(studentEdits).length > 0 && (
                    <Button onClick={saveStudentDetails} disabled={savingStudents}>
                      {savingStudents ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                      Save Changes
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">CSV format: name, gender, matric_no (header row required)</p>
            </CardHeader>
            <CardContent>
              {students.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No students yet.</p>
                  <p className="text-sm text-muted-foreground mt-1">Add them manually or import a CSV file.</p>
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
                      {students.map(student => {
                        const edits = studentEdits[student.id] || {};
                        return (
                          <TableRow key={student.id}>
                            <TableCell>
                              <Input value={edits.name ?? student.name} onChange={(e) => updateStudentField(student.id, 'name', e.target.value)} className="min-w-[140px]" />
                            </TableCell>
                            <TableCell>
                              <Select value={edits.gender ?? student.gender ?? ''} onValueChange={(v) => updateStudentField(student.id, 'gender', v)}>
                                <SelectTrigger className="w-[120px]"><SelectValue placeholder="Select" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Male">Male</SelectItem>
                                  <SelectItem value="Female">Female</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input value={edits.matric_no ?? student.matric_no ?? ''} onChange={(e) => updateStudentField(student.id, 'matric_no', e.target.value)} placeholder="e.g., MAT/2024/001" className="min-w-[160px]" />
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon" onClick={() => deleteStudent(student.id, student.name)} className="text-destructive hover:text-destructive">
                                <Trash2 className="w-4 h-4" />
                              </Button>
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

        {activeTab === 'history' && (
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-lg">Attendance History</CardTitle>
                <div className="flex flex-wrap gap-2">
                  {/* <SheetsActions
                    busy={sheetsBusy}
                    size="sm"
                    onExport={() => pushToGoogleSheets('export_all')}
                    onSync={() => pushToGoogleSheets('sync_unsynced')}
                  /> */}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={deleteAllHistory}
                    disabled={deletingHistory || history.length === 0}
                  >
                    {deletingHistory ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
                    {deletingHistory ? 'Deleting...' : 'Delete All History'}
                  </Button>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 mt-3">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or matric no..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-8"
                  />
                </div>
                <Select value={filterPercent} onValueChange={setFilterPercent}>
                  <SelectTrigger className="w-[180px]">
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
                {filteredStats.slice(0, 12).map(student => (
                  <div key={student.id} className="p-3 rounded-lg border bg-muted/30">
                    <p className="font-medium text-sm truncate" title={student.name}>{student.name}</p>
                    {student.matric_no && (
                      <p className="text-xs text-muted-foreground">{student.matric_no}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Present: {student.present} / {student.total}
                    </p>
                    <p className={`text-sm font-bold mt-1 ${student.percent >= 75 ? 'text-green-600' : 'text-red-500'}`}>
                      {student.percent.toFixed(1)}%
                    </p>
                  </div>
                ))}
                {filteredStats.length === 0 && (
                  <p className="text-muted-foreground text-sm col-span-full text-center py-4">No students match your search/filter.</p>
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
                    {filteredHistory
                      .filter(r => {
                        if (!searchQuery.trim()) return true;
                        const q = searchQuery.toLowerCase();
                        return (
                          (r.students?.name?.toLowerCase().includes(q)) ||
                          (r.students?.matric_no?.toLowerCase().includes(q))
                        );
                      })
                      .slice(0, 100)
                      .map((r, idx) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-center font-medium">{idx + 1}</TableCell>
                          <TableCell className="max-w-[200px] truncate" title={r.students?.name ?? 'Unknown'}>
                            {r.students?.name ?? 'Unknown'}
                          </TableCell>
                          <TableCell>{r.students?.matric_no ?? '-'}</TableCell>
                          <TableCell>{r.students?.gender ?? '-'}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {r.courses?.code || '-'}
                            </Badge>
                          </TableCell>
                          <TableCell>{r.date}</TableCell>
                          <TableCell>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusStyles[r.status] || 'bg-muted'}`}>
                              {r.status}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    {filteredHistory.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No attendance records yet. Start marking attendance!
                        </TableCell>
                      </TableRow>
                    )}
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
