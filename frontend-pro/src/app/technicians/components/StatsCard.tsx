import { Card, CardContent } from "@/components/ui/card";

export function StatsCard({
    title,
    value,
    icon: Icon,
    iconColor,
    bgColor,
    isActive,
    onClick,
}: {
    title: string;
    value: string;
    icon: React.ElementType;
    iconColor: string;
    bgColor: string;
    isActive?: boolean;
    onClick?: () => void;
}) {
    return (
        <Card
            onClick={onClick}
            className={`border-none shadow-sm transition-all duration-200 cursor-pointer ${isActive
                    ? "ring-2 ring-emerald-500 bg-emerald-50/50"
                    : "bg-white hover:shadow-md hover:bg-gray-50"
                }`}
        >
            <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                    <div
                        className={`p-3 rounded-full ${isActive ? "bg-white" : bgColor
                            } flex items-center justify-center`}
                    >
                        <Icon className={`h-6 w-6 ${iconColor}`} />
                    </div>
                    {isActive && (
                        <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    )}
                </div>
                <div className="space-y-1">
                    <h3
                        className={`text-sm font-medium ${isActive ? "text-emerald-700" : "text-gray-500"
                            }`}
                    >
                        {title}
                    </h3>
                    <span
                        className={`text-2xl font-bold ${isActive ? "text-emerald-900" : "text-gray-900"
                            }`}
                    >
                        {value}
                    </span>
                </div>
            </CardContent>
        </Card>
    );
}
