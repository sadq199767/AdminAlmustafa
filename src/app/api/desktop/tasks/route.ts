import { NextRequest } from 'next/server';
import { saveDesktopTask } from '@/lib/desktop-task-mutation';
export async function POST(req: NextRequest) { return saveDesktopTask(req); }
